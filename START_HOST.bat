@echo off
title Remote Assist - Host Controller
color 09
cd /d "%~dp0host"

echo =========================================================
echo       REMOTE ASSIST - HOST REMOTE CONTROLLER
echo =========================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

if not exist node_modules (
    echo Installing dependencies...
    call npm install
)

echo Starting Host Controller...
node controller.js
pause
