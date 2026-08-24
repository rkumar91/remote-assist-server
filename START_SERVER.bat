@echo off
title Remote Assist - Signaling & Relay Server
color 0B
cd /d "%~dp0server"

echo =========================================================
echo       REMOTE ASSIST - SIGNALING & RELAY SERVER
echo =========================================================
echo.
echo Starting Signaling Server on port 9090...
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

node server.js
pause
