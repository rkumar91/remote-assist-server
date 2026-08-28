@echo off
title Remote Assist - 1-Click Complete Local Demo
color 0B
cd /d "%~dp0"

echo =========================================================
echo       REMOTE ASSIST - 1-CLICK ALL-IN-ONE DEMO
echo =========================================================
echo.
echo Launching:
echo   1. Local Signaling & Relay Server (Port 9090)
echo   2. End-User Client (Port 48100)
echo   3. Host Controller (Port 48200)
echo.

start "Remote Assist - Local Server" cmd /k "START_SERVER.bat"
timeout /t 2 >nul

start "Remote Assist - End User" cmd /k "START_END_USER.bat"
timeout /t 2 >nul

start "Remote Assist - Host" cmd /k "START_HOST.bat"

echo All 3 components have been launched!
echo Check your browser windows to pair the ID and PIN.
echo.
pause
