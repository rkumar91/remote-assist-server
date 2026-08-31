@echo off
title Remote Assist - Stop Agent
color 0C

echo =========================================================
echo       STOPPING REMOTE ASSIST UTILITY (END USER)
echo =========================================================
echo.

echo Terminating screen capture and input helpers...
taskkill /F /IM RemoteCapture.exe /T 2>nul
taskkill /F /IM RemoteInput.exe /T 2>nul

echo Stopping agent process on port 48100...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":48100" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a 2>nul
)

echo.
echo [SUCCESS] Remote Assist has been completely stopped.
echo.
timeout /t 3
exit /b 0
