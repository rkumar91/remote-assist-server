@echo off
title Remote Assist - End User Client
color 0A
cd /d "%~dp0"

echo =========================================================
echo       REMOTE ASSIST - END USER SHARING UTILITY
echo =========================================================
echo.


where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

:: Compile native helpers if missing
if not exist "RemoteInput.exe" (
    echo Compiling native Input Injector...
    C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /out:RemoteInput.exe /target:exe /optimize+ input_injector.cs >nul 2>nul
)

if not exist "RemoteCapture.exe" (
    echo Compiling native Screen Capturer...
    C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /r:System.Drawing.dll /out:RemoteCapture.exe /target:exe /optimize+ screen_capture.cs >nul 2>nul
)

if not exist node_modules (
    echo Installing dependencies...
    call npm install >nul 2>nul
)

echo Starting End-User Agent...
node agent.js
pause


