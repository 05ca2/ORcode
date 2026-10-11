// 编排器：Director 拆解 → Planner 规划(含 waves) → Director 分派 → Workers 按波次并发执行
//        → Verifier 连续核查 N 遍（全部通过才输出；否则整轮回 Planner 重规划） → 最终输出
import { runAgent } from './agents.js';
import { parseJSON, truncate, mapLimit } from './util.js';

function buildEnv(cfg, plugins, ctx, mock, trace) {
  return { cfg, plugins, ctx, mock, trace };
}

function safeParse(text) {
  try { return parseJSON(text); } catch { return null; }
}

function buildVerifyPrompt(task, results, round, attempt, verifyRounds) {
  const summary = results.map((r, i) =>
    `步骤${i + 1} [${r.role}] ${r.instruction}\n结论:\n${truncate(r.result, 800)}`
  ).join('\n\n');
  // 在首行加入便于 mock 解析的标记
  return `ATTEMPT:${attempt}\nROUND:${round}\nVERIFICATIONS:${verifyRounds}\n\n【原始用户任务】\n${task}\n\n【各岗位交付结果】\n${summary}\n\n这是第 ${attempt} 轮「规划-执行」完成后的第 ${round + 1} 次核查（需在 ${verifyRounds} 次核查中连续全部通过，才算真正完成）。请严格判断当前交付是否真的完成、没有遗留/错误问题。`;
}

function buildReplanPrompt(task, dirJson, prevPlan, gaps, attempt) {
  const items = (prevPlan || []).map((s, i) => `${i + 1}. [${s.role}] ${s.instruction}`).join('\n');
  return `【原始任务】\n${task}\n\n【之前的拆解】\n${JSON.stringify(dirJson || {})}\n\n【上一次执行计划】\n${items}\n\n【Verifier 指出的待修复问题】\n${(gaps || []).join('\n')}\n\n这是第 ${attempt} 次重规划。请基于以上问题重新制定执行计划与波次(waves)，并输出 JSON：\n{\n "plan": [ {"role":"可选岗位之一","instruction":"该步骤要做什么"} ],\n "waves": [ [0,1], [2] ]   // 每个 wave 是一组【可并行】的步骤下标(从0开始)；有依赖的步骤必须放在更晚的 wave\n}`;
}

export async function runPipeline(task, cfg, plugins, ctx, mock = false, trace) {
  const T = trace || {};
  const env = buildEnv(cfg, plugins, ctx, mock, trace);
  const stages = cfg.pipeline?.stages || ['director', 'planner', 'workers', 'verifier'];
  const maxWorkers = Math.max(1, cfg.pipeline?.max_workers || 1);
  const verifyRounds = Math.max(1, cfg.pipeline?.verify_rounds || 2);
  const MAX_ATTEMPTS = 4;

  const roleList = Object.entries(cfg.roles || {}).map(([k, v]) => `${k}(${v.name || k})`).join('、') || '（无）';
  const resolveRole = (id) => cfg.roles[id] || cfg.roles.coder || cfg.roles.workers || Object.values(cfg.roles)[0];

  let dirJson = null;
  let planJson = null;
  let dispatchJson = null;
  let results = [];
  let verdict = null;
  let gaps = [];
  let attempts = 0;
  let waves = [];

  // 1) Director 拆解（发现关键不确定点时，可先发澄清问卷）
  if (stages.includes('director') && cfg.roles.director) {
    const CLARIFY_RULE = '\n\n【重要】若任务存在影响拆解的关键不确定点（目标/范围/技术栈/平台/优先级等），先不要拆解，改为输出：\n{"need_clarification": true, "questions": ["问题1", "问题2", ...]}\n（问题不超过 5 个，只问真正影响方案的；没有不确定点就直接输出拆解 JSON）';
    T.stage?.('指挥 Director', '把任务拆成工作项');
    let out = await runAgent(cfg.roles.director, `用户任务：\n${task}${CLARIFY_RULE}`, env, { streamTokens: false });
    dirJson = safeParse(out) || {};
    if (dirJson?.need_clarification && Array.isArray(dirJson.questions) && dirJson.questions.length && typeof T.clarify === 'function') {
      T.stage?.('澄清 Clarify', `${dirJson.questions.length} 个问题需要确认`);
      const answers = await T.clarify(dirJson.questions);
      const supplement = dirJson.questions.map((q, i) => `问：${q}\n答：${answers?.[i] ?? '（未回答）'}`).join('\n');
      T.info?.('已收到补充说明，重新拆解任务');
      out = await runAgent(cfg.roles.director, `用户任务：\n${task}\n\n用户补充说明：\n${supplement}\n\n请基于以上信息完成拆解（若已足够清晰，直接输出拆解 JSON）。`, env, { streamTokens: false });
      dirJson = safeParse(out) || {};
    }
    T.result?.('总览', dirJson.overview || '(无)');
    (dirJson.items || []).forEach((it) => T.info?.(`· [${it.role}] ${it.title} —— ${it.goal}`));
  }

  // 2) 规划 → 分派 → 执行 → 核查 闭环
  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    const replanning = attempts > 1;
    if (replanning) { gaps = gaps && gaps.length ? gaps : ['（上次未通过核查，但 Verifier 未给出具体缺口）']; T.replan?.(attempts, gaps); }

    // --- Planner 规划（含 waves）---
    if (stages.includes('planner') && cfg.roles.planner) {
      T.stage?.('规划 Planner', replanning ? `第 ${attempts} 次重规划（修复缺口）` : '制定分工与波次(waves)');
      const baseCtx = dirJson ? `原始任务：\n${task}\n\n指挥拆解：\n${JSON.stringify(dirJson)}` : `原始任务：\n${task}`;
      const extra = replanning
        ? `\n\n【上一次执行计划】\n${(planJson?.plan || []).map((s, i) => `${i + 1}. [${s.role}] ${s.instruction}`).join('\n')}\n\n【Verifier 指出的待修复问题】\n${(gaps || []).join('\n')}\n\n请基于以上问题重新规划。`
        : '';
      const waveRule = `\n\n请输出 JSON：\n{\n "plan": [ {"role":"可选岗位之一","instruction":"该步骤要做什么"} ],\n "waves": [ [0,1], [2] ]   // 每个 wave 是一组【可并行】的步骤下标(从0开始)；有依赖的步骤必须放在更晚的 wave\n}\n可用岗位(role)：${roleList}`;
      const out = await runAgent(cfg.roles.planner, baseCtx + extra + waveRule, env, { streamTokens: false });
      planJson = safeParse(out);
      if (!planJson || !Array.isArray(planJson.plan) || !planJson.plan.length) {
        // 兜底：直接把任务作为单一 coder 步骤
        planJson = { plan: [{ role: resolveRole(null)?.id || 'coder', instruction: task }], waves: [[0]] };
      }
      (planJson.plan || []).forEach((s, i) => T.info?.(`${i + 1}. [${s.role}] ${s.instruction}`));
    } else if (!planJson) {
      planJson = { plan: [{ role: resolveRole(null)?.id || 'coder', instruction: task }], waves: [[0]] };
    }

    // --- Director 分派（真实调用：签收计划并下发波次）---
    if (cfg.roles.director) {
      T.dispatch?.('指挥 Director · 分派', '签收计划并下发波次');
      const out = await runAgent(cfg.roles.director, `你是总指挥 Director。规划岗 Planner 已给出执行计划与波次，请你签收计划并正式分派给 Worker。\n\n原始任务：\n${task}\n\n指挥拆解：\n${JSON.stringify(dirJson || {})}\n\n规划（含 waves）：\n${JSON.stringify(planJson)}\n\n请输出 JSON：{"waves": [[0,1], ...], "notes": "分派说明"}（waves 沿用规划的并行分组，必要时可微调；下标从 0 开始，对应 plan 数组）`, env, { streamTokens: false });
      dispatchJson = safeParse(out);
    }

    // --- Workers：按 wave 逐波执行，每波并发 = min(wave 大小, 额定并行数) ---
    const rawWaves = (dispatchJson && Array.isArray(dispatchJson.waves) && dispatchJson.waves.length)
      ? dispatchJson.waves
      : (planJson.waves && Array.isArray(planJson.waves) && planJson.waves.length)
        ? planJson.waves
        : (planJson.plan || []).map((_, i) => [i]);
    const planLen = (planJson.plan || []).length;
    waves = rawWaves
      .map((w) => (Array.isArray(w) ? w : [w]).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < planLen))
      .filter((w) => w.length);
    if (!waves.length) waves.push((planJson.plan || []).map((_, i) => i));

    results = [];
    const totalWaves = waves.length;
    T.stage?.('执行 Workers', `按 ${totalWaves} 个波次执行（额定并行=${maxWorkers}）`);
    for (let wi = 0; wi < waves.length; wi++) {
      const idxs = waves[wi];
      T.wave?.(wi + 1, totalWaves, idxs.length);
      const execOne = async (idx) => {
        const step = planJson.plan[idx];
        const role = resolveRole(step.role);
        if (!role) throw new Error('找不到岗位: ' + step.role);
        T.step?.(step.role, step.instruction);
        const r = await runAgent(role, `整体任务：${task}\n你的步骤指令：${step.instruction}`, env);
        return { role: step.role, instruction: step.instruction, result: r };
      };
      const conc = Math.min(idxs.length, maxWorkers);
      const done = await mapLimit(idxs, conc, execOne);
      results.push(...done);
    }
    T.info?.(`执行完成：共 ${results.length} 个岗位交付`);

    // --- Verifier：连续 verifyRounds 遍全部通过才算完成 ---
    let streak = 0;
    for (let round = 0; round < verifyRounds; round++) {
      T.stage?.('检验 Verifier', `第 ${round + 1}/${verifyRounds} 次核查（第 ${attempts} 轮尝试）`);
      const out = await runAgent(cfg.roles.verifier, buildVerifyPrompt(task, results, round, attempts, verifyRounds), env, { streamTokens: false });
      const v = safeParse(out) || {};
      verdict = v;
      const passed = !!v.passed;
      T.verify?.(round + 1, passed, v.score);
      T.result?.('核查结论', `第 ${round + 1} 次：${passed ? '通过' : '未通过'} · 评分 ${v.score ?? '-'}${v.verdict ? ' · ' + v.verdict : ''}`);
      if (passed) streak++;
      else { streak = 0; gaps = Array.isArray(v.gaps) && v.gaps.length ? v.gaps : ['（Verifier 未说明具体缺口）']; T.gaps?.(gaps); break; }
    }
    T.info?.(`核查结果：${streak}/${verifyRounds} 连续通过`);

    if (streak >= verifyRounds) { T.final?.(); break; }
    if (attempts >= MAX_ATTEMPTS) {
      T.result?.('已达最大重规划次数', `仍 ${streak}/${verifyRounds} 通过，停止并交付当前结果`);
      break;
    }
    // 否则继续循环 → Planner 重规划（gaps 已更新）
  }

  const report = { dirJson, planJson, dispatchJson, waves, results, verdict, attempts };
  T.done?.(report);
  return report;
}
