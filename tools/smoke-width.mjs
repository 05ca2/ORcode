// 无头验证：emoji/宽字符测量修复 + 3 行高输入框 + 滚动归位
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

const fs = await import('node:fs');
const path = await import('node:path');
const os = await import('node:os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-wid-'));
process.chdir(tmp);
fs.mkdirSync(path.join(tmp, '.omni'), { recursive: true });
fs.writeFileSync(path.join(tmp, '.omni', 'config.json'), JSON.stringify({
  models: { ds: { base_url: 'https://api.deepseek.com/v1', api_key: 'sk-test-1234567890', model: 'deepseek-chat', provider: 'DeepSeek', display: 'DeepSeek V3' } },
  roles: { director: { model: 'ds', tools: [] } },
}, null, 2));

process.argv = [process.argv[0], 'orcode.js', 'chat', '--mock'];
await import('../bin/orcode.js');
await new Promise((r) => setTimeout(r, 300));

const type = (s) => dataHandler && dataHandler(Buffer.from(s, 'utf8'));
const frameCount = () => chunks.join('').split('\x1b[H\x1b[2J').length - 1;

// 1) 输入含 emoji / 宽字符的消息并提交
type('Hello 👋 ✅ ☀️ 你好世界 wide-line test done');
await new Promise((r) => setTimeout(r, 200));
chunks.length = 0; // 只看提交后的帧
dataHandler(Buffer.from('\r', 'utf8'));
await new Promise((r) => setTimeout(r, 1200));

const all = chunks.join('');
const frames = all.split('\x1b[H\x1b[2J').filter((f) => f.length > 100);
const last = frames[frames.length - 1] || '';
const plain = last.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const lines = plain.split('\n');
const barCount = (last.match(/\x1b\[48;5;236m/g) || []).length;

let fail = 0;
const check = (name, ok) => { realWrite((ok ? '  ✓ ' : '  ✗ ') + name + '\n'); if (!ok) fail = 1; };

check('提交后仍持续渲染（frames=' + frames.length + '）', frames.length >= 1);
check('emoji 出现在会话流（👋）', plain.includes('\u{1F44B}'));
check('emoji 出现在会话流（✅）', plain.includes('\u2705'));
check('3 行高输入框（barBg 段数 >= 3，实际 ' + barCount + '）', barCount >= 3);
check('帧行数 = 30（rows）', lines.length === 30);
check('帧顶部即像素字标（█ 开头不空行）', lines[0].includes('█'));

// 2) 独立测量宽度：用本文件自己的宽度函数（emoji=2）验证每个会话行没超 MW
function w(s) { let n = 0; for (const ch of s) { const x = ch.codePointAt(0); n += (x >= 0x1F000 && x <= 0x1FAFF) || x === 0x2705 ? 2 : x > 0xFFFF ? 2 : x >= 0x2E80 && x <= 0xA4CF ? 2 : 1; } return n; }
const MW = Math.floor(110 * 0.68);
const over = lines.filter((l) => w(l) > MW + 3 + 1 + Math.max(10, 110 - MW - 3)).length; // 整行 = MW + 3 + RW
check('无整行超屏（independent width check）', over === 0);

// 3) 提交后滚动归位：滚轮上滚（ESC[<64;x y M）再提交新消息 → 应回到最新
dataHandler(Buffer.from('\x1b[<64;5;5M', 'utf8'));
await new Promise((r) => setTimeout(r, 150));
dataHandler(Buffer.from('/clear\r', 'utf8'));
await new Promise((r) => setTimeout(r, 400));
const frames2 = chunks.join('').split('\x1b[H\x1b[2J').filter((f) => f.length > 100);
const last2 = frames2[frames2.length - 1] || '';
check('滚轮上滚后提交命令 → 视图回到底部（无历史提示行）', !last2.includes('行历史'));

realWrite(fail ? '[WID] FAIL\n' : '[WID] PASS\n');
process.exit(fail);
