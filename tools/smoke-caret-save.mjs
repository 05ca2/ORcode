// 无头验证：输入框光标（左右键 + Home/End + 鼠标）→ 中间插入/删除；存档 /save /load /sessions
const chunks = [];
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (s) => { chunks.push(String(s)); return true; };
process.stdout.isTTY = true;
process.stdout.columns = 110;
process.stdout.rows = 30;
process.stdin.isTTY = true;
let dataHandler = null;
process.stdin.setRawMode = () => {};
process.stdin.resume = () => {};
process.stdin.pause = () => {};
process.stdin.on = (ev, fn) => { if (ev === 'data') dataHandler = fn; };
process.stdin.removeListener = () => {};
process.stdin.once = () => {};

const fsMod = await import('node:fs');
const pathMod = await import('node:path');
const os = await import('node:os');

const tmp = fsMod.mkdtempSync(pathMod.join(os.tmpdir(), 'omni-caretsave-'));
process.chdir(tmp);
fsMod.mkdirSync(pathMod.join(tmp, '.omni'), { recursive: true });
fsMod.writeFileSync(pathMod.join(tmp, '.omni', 'config.json'), JSON.stringify({
  models: { ds: { base_url: 'https://api.deepseek.com/v1', api_key: 'sk-test-1234567890', model: 'deepchat', provider: 'DeepSeek', display: 'DeepSeek V3' } },
  roles: { director: { model: 'ds', tools: [] } },
}, null, 2));

process.argv = [process.argv[0], 'orcode.js', 'chat', '--mock'];
process.env.OMNI_TEST = '1';
await import('../bin/orcode.js');
const T = globalThis.__OMNI_TEST;
await new Promise((r) => setTimeout(r, 300));

let fail = 0;
const check = (name, ok, extra = '') => { realWrite((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? ' → ' + extra : '') + '\n'); if (!ok) fail = 1; };

// ---- 1) 真实按键：输入后左键移到中间插入 ----
const typeReal = (s) => dataHandler(Buffer.from(s, 'utf8'));
typeReal('hello'); // 走真实 onKey 输入路径（末尾插入）
check('输入 hello，caret 在行尾', T.getState().line === 'hello' && T.getState().caret === 5, JSON.stringify(T.getState().line));
typeReal('\x1b[D'); typeReal('\x1b[D'); // 左键 ×2 → caret=3
check('左键 ×2 → caret=3', T.getState().caret === 3, 'caret=' + T.getState().caret);
typeReal('X'); // 中间插入
check('中间插入 X → helXlo', T.getState().line === 'helXlo', JSON.stringify(T.getState().line));

// ---- 2) Backspace / Delete（真实按键）----
// helXlo 代码点：0h 1e 2l 3X 4l 5o；Home→caret=0；右移×2→caret=2（指向 l）
typeReal('\x1b[H'); check('Home → caret=0', T.getState().caret === 0);
typeReal('\x1b[C'); typeReal('\x1b[C');
check('右移 ×2 → caret=2', T.getState().caret === 2, 'caret=' + T.getState().caret);
typeReal('\x7f'); // Backspace 删左侧 e → hlXlo
check('Backspace 删左侧 → hlXlo', T.getState().line === 'hlXlo', JSON.stringify(T.getState().line));
typeReal('\x1b[3~'); // Delete 删右侧 l（caret=2 指向 l）→ hXlo
check('Delete 删右侧 → hXlo', T.getState().line === 'hXlo', JSON.stringify(T.getState().line));
typeReal('\x1b[F'); check('End → caret 行尾', T.getState().caret === T.getState().line.length);

// ---- 3) 鼠标点击定位光标（从热区里取输入行真实行号，点击第 7 列）----
T.type('abcde'); // abcde，点击第 7 列 → 文本起点 4，列7=第 3 个字符(c)之后 → caret=3
const z = T.getState().zones.find((z) => z.t === 'caret');
check('输入框光标热区已注册', !!z, z ? 'row=' + z.y1 : '无');
if (z) {
  dataHandler(Buffer.from(`\x1b[<0;7;${z.y1}M`, 'utf8'));
  check('鼠标点击 → caret 定位到第 7 列对应位置（=3）', T.getState().caret === 3, 'caret=' + T.getState().caret);
}

// ---- 4) 存档 /save /load /sessions ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
typeReal('\x1b'); await sleep(90); // esc 清掉当前输入行（esc 有 60ms 计时器，稍等）
T.save('test1'); // 用测试钩子直接存档（绕开输入，专注存档逻辑）
const sessDir = pathMod.join(tmp, '.omni', 'sessions');
const files = fsMod.readdirSync(sessDir).filter((f) => f.endsWith('.json'));
check('/save 生成存档文件', files.includes('test1.json'), files.join(','));
const saved = JSON.parse(fsMod.readFileSync(pathMod.join(sessDir, 'test1.json'), 'utf8'));
check('存档含 transcript/chatHistory/subs 字段', !!(saved.transcript && saved.chatHistory && saved.subs));

// 修改当前会话后 /load 恢复
typeReal('/clear\r'); // 经真实回车执行 /clear
await new Promise((r) => setTimeout(r, 200));
check('/clear 后 transcript 清空', T.getState().transcript.length === 0, 'len=' + T.getState().transcript.length);
T.load('test1');
await new Promise((r) => setTimeout(r, 200));
check('/load 恢复会话内容', T.getState().transcript.length > 0, 'len=' + T.getState().transcript.length);

realWrite(fail ? '[CARETAIN] FAIL\n' : '[CARETAIN] PASS\n');
process.exit(fail);
