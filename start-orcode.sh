#!/bin/bash
# ORcode 启动脚本 - 用于 Git Bash 环境
# 这个脚本提供了完整的 TTY 支持

cd "/mnt/d/新建文件夹/openrelay" || exit 1

# 检查 Node 是否可用
if ! command -v node &> /dev/null; then
    echo "错误：未找到 Node.js，请先安装 Node.js"
    exit 1
fi

# 启动 ORcode
node bin/orcode.js chat --mock

# 保持退出码
exit $?
