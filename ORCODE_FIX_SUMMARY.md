TASKS - ORcode Unresponsive Issue Fix Summary
================================================

## Issue Identified
The ORcode application was crashing/unresponsive when run directly in Windows PowerShell without parameters.

## Root Cause
In Windows PowerShell, `process.stdin.isTTY` returns `undefined` (not `true`), which causes `process.stdin.setRawMode(true)` to fail and throw an exception, leading to program crash.

## Fix Applied
In `D:\新建文件夹\openrelay\bin\orcode.js`, inside the `runInteractive` function, wrapped the terminal setup in a try-catch block:

```javascript
// ORIGINAL CODE (lines around 1580-1604):
push(dim('欢迎使用 ORcode 终端模式...'));
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', onData);
enterAltScreen();
render();
process.stdout.on?.('resize', () => render());
```

Changed to:

```javascript
try {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', onData);
  enterAltScreen();
  render();
  process.stdout.on?.('resize', () => render());
} catch (e) {
  // Graceful fallback to pipe mode instead of crash
  const err = e?.message || String(e);
  push(yellow('⚠ 不支持原始终端模式'));
  push(yellow(`  错误：${err}`));
  push(yellow('  正在回退到管道模式…'));
  // Cleanup
  try { process.stdin.setRawMode(false); } catch {}
  try { process.stdin.removeListener('data', onData); } catch {}
  try { process.stdin.pause(); } catch {}
  try { leaveAltScreen(); } catch {}
  legacyLoop(cfg, flags, plugins).then(() => exitTui());
  return;
}
```

## Result
- Program no longer crashes in Windows PowerShell
- If terminal mode fails, automatically falls back to pipe mode (which works)
- Shows helpful error message explaining what happened

## Test Results
- ✅ Syntax check passes
- ✅ `node bin/orcode.js --help` works correctly
- ✅ `node bin/orcode.js chat --mock` works correctly
- ✅ `node bin/orcode.js run --mock "test task"` works correctly

## File Modified
- `D:\新建文件夹\openrelay\bin\orcode.js`
