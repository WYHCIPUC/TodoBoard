@echo off
setlocal
title Linggan Board
cd /d "%~dp0"
set "BOARD_PORT=3865"
if defined PORT set "BOARD_PORT=%PORT%"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [STARTUP FAILED] Node.js was not found.
  echo Install Node.js 22 or newer, then run start.bat again.
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

:doctor
node scripts\doctor.js --startup
set "DOCTOR_CODE=%ERRORLEVEL%"

if "%DOCTOR_CODE%"=="2" goto open_existing
if "%DOCTOR_CODE%"=="3" goto install_dependencies
if not "%DOCTOR_CODE%"=="0" goto startup_failed

echo Starting Linggan Board...
echo Keep this window open. Press Ctrl+C to stop the service.
echo.
node server.js
set "SERVER_CODE=%ERRORLEVEL%"
if "%SERVER_CODE%"=="0" exit /b 0

echo.
echo [SERVICE STOPPED] Exit code: %SERVER_CODE%
echo Error log: %~dp0.linggan\server-error.log
pause
exit /b %SERVER_CODE%

:open_existing
echo Linggan Board is already running. Opening the browser...
node scripts\open-browser.js "http://127.0.0.1:%BOARD_PORT%/"
if errorlevel 1 (
  echo Open this address manually: http://127.0.0.1:%BOARD_PORT%/
  pause
  exit /b 1
)
exit /b 0

:install_dependencies
where npm >nul 2>nul
if errorlevel 1 (
  echo [STARTUP FAILED] Dependencies are missing and npm was not found.
  echo Reinstall Node.js 22 or newer, then try again.
  pause
  exit /b 1
)
echo Installing dependencies for the first run. Keep the network connected...
call npm ci
if errorlevel 1 (
  echo.
  echo [INSTALL FAILED] Check your network, proxy, or npm settings.
  pause
  exit /b 1
)
goto doctor

:startup_failed
echo [STARTUP FAILED] Review the diagnostics above.
echo To use another port: set PORT=3866 ^&^& start.bat
echo Error log: %~dp0.linggan\server-error.log
pause
exit /b 1
