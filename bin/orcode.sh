#!/usr/bin/env bash
# ORcode 启动脚本 - 保证在所有 POSIX 系统上都能工作
# 使用方法：orcode [选项]

set -e

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# 检查 Node.js 是否可用
command -v node >/dev/null 2>&1 || { 
    echo "错误：未找到 Node.js" >&2
    echo "请先安装 Node.js 18+ " >&2
    exit 1
}

# 切换到项目目录
cd "$PROJECT_DIR"

# 获取当前命令行参数
ARGS=("$@")

# 检查是否是 TTY 模式
if [ -t 0 ] && [ -t 1 ]; then
    # 原生 TTY 模式
    exec node "./src/orcode.js" "${ARGS[@]}"
else
    # 管道模式
    echo "注意：检测到管道模式（可能在使用 crontab 或脚本调用）"
    echo "ORcode 将在非交互式模式下运行"
    exec node "./src/orcode.js" --pipe-mode "${ARGS[@]}"
fi
