@echo off
title Remote Assist - Launch All Local Demo
color 0E
cd /d "%~dp0"

echo =========================================================
echo       LAUNCHING REMOTE ASSIST LOCAL DEMO
echo =========================================================
echo.
echo 1. Starting Signaling Server (Port 9090)...
start "Remote Assist Server" cmd /k "START_SERVER.bat"
timeout /t 2 /nobreak >nul

echo 2. Starting End-User Client (Port 48100)...
start "Remote Assist End-User" cmd /k "START_END_USER.bat"
timeout /t 2 /nobreak >nul

echo 3. Starting Host Controller (Port 48200)...
start "Remote Assist Host" cmd /k "START_HOST.bat"

echo.
echo All components started! Check your browser windows.
pause
