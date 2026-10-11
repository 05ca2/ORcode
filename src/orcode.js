#!/usr/bin/env node
import { runPipeline, chatCompletion, renderReport, cliTrace, loadPlugins, runInteractive, UI } from './index.js';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { spawnSync } from 'child_process';

// ORcode 核心: 处理命令行参数并统一运行
function main(argv = []) {
  const args = argv.slice(2);
  const isTTY = typeof process.stdin.setRawMode === 'function' && process.stdin.isTTY;
  
  if (args.includes('--pipe-mode') || !isTTY) {
    // 管道模式
    process.stdout.write(`\x1b[1;36m  交互模式（管道）。会话命令：/mock /model <id> /reload /status /exit\x1b[0m\n`);
    process.stdout.write(`omni ❯ `); // 或者用交互式输出
    
    // 这里可以加入环形读取输入，直到退出
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });
    
    const prompt = () => {
      process.stdout.write(`\x1b[1;36momni ❯ \x1b[0m`);
    };
    
    prompt();
    
    for (const line of rl) {
      const t = line.trim();
      if (!t) { prompt(); continue; }
      if (t === '/exit' || t === '/quit') break;
      if (t === '/mock') continue; // 演示模式
      // ...其他命令
      prompt();
    }
    
    rl.close();
    return;
  }
  
  // TTY 模式：进入完整界面
  runInteractiveCore(args);
}

// 优化：将 runInteractive 从 orcode.js 中释放，变成一个独立的函数
export function runInteractiveCore(args) {
  // 原 orcode.js 中的 runInteractive 函数代码，移除 IS_TTY 检查
  // 返回一个 Promise
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
