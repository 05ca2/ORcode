@echo off
title ORcode - Git Bash
echo ===========================================
echo  ORcode 终端界面启动中...
echo ===========================================
echo.
echo 正在启动 Git Bash 环境，请稍候...
echo.
call "D:\userdata\.workbuddy\binaries\PortableGit\versions\1.2.0\mingw64\bin\git-bash.exe" -c "cd /mnt/d/新建文件夹/openrelay && node bin/orcode.js chat --mock"
echo.
echo ===========================================
echo ORcode 已退出!
echo ===========================================
pause >nul
