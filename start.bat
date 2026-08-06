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
echo Data: %~dp0README.md
echo Close this window to stop.
echo.
node server.js
pause
