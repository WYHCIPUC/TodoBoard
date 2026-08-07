@echo off
setlocal
title Linggan Board Portable
cd /d "%~dp0"
set "BOARD_PORT=3865"
if defined PORT set "BOARD_PORT=%PORT%"
set "PORTABLE_NODE=%~dp0runtime\node.exe"

if not exist "%PORTABLE_NODE%" (
  echo.
  echo [STARTUP FAILED] The portable runtime is incomplete.
  echo Extract the entire ZIP before running this file.
  echo Missing: %PORTABLE_NODE%
  pause
  exit /b 1
)

"%PORTABLE_NODE%" scripts\doctor.js --startup
set "DOCTOR_CODE=%ERRORLEVEL%"
if "%DOCTOR_CODE%"=="2" goto open_existing
if not "%DOCTOR_CODE%"=="0" goto startup_failed

echo Starting Linggan Board Portable...
echo Keep this window open. Press Ctrl+C to stop the service.
echo.
"%PORTABLE_NODE%" server.js
set "SERVER_CODE=%ERRORLEVEL%"
if "%SERVER_CODE%"=="0" exit /b 0

echo.
echo [SERVICE STOPPED] Exit code: %SERVER_CODE%
echo Error log: %~dp0docs\server-error.log
pause
exit /b %SERVER_CODE%

:open_existing
echo Linggan Board is already running. Opening the browser...
"%PORTABLE_NODE%" scripts\open-browser.js "http://127.0.0.1:%BOARD_PORT%/"
if errorlevel 1 (
  echo Open this address manually: http://127.0.0.1:%BOARD_PORT%/
  pause
  exit /b 1
)
exit /b 0

:startup_failed
echo [STARTUP FAILED] The portable package may be incomplete.
echo Extract the entire ZIP to a writable folder and try again.
echo Error log: %~dp0docs\server-error.log
pause
exit /b 1
