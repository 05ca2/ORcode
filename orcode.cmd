@echo off
title ORcode TTY
echo ORcode：入门 TTY 模式
cd /d "%~dp0"
if exist "." (
    call "D:\userdata\.workbuddy\binaries\PortableGit\versions\1.2.0\mingw64\bin\git-bash.exe" -c "cd /mnt/d/新建文件夹/openrelay && node bin/orcode.js chat --mock"
) else (
    call "D:\userdata\.workbuddy\binaries\PortableGit\versions\1.2.0\mingw64\bin\git-bash.exe" -c "cd %~dp0 && node bin/orcode.js chat --mock"
)
