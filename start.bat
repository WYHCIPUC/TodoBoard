@echo off
chcp 65001 >nul 2>nul
title Todo Board
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install from https://nodejs.org/
  pause
  exit /b 1
)

echo Starting board service...
echo Data: %~dp0DATA.md
echo.
echo ----- 企业微信转发入库（可选）-----
echo 如需启用，在下方 set 行填入你的企业微信参数（见 docs/WECOM-GUIDE.md）
echo ----------------------------------
echo.

node server.js
pause
