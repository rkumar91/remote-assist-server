@echo off
title RemoteAssist Pro - Standalone Packager
cls
echo ======================================================
echo    REMOTEASSIST PRO - COMMERCIAL STANDALONE BUILDER
echo ======================================================
echo.
cd /d "%~dp0standalone_pro"

echo [*] Checking dependencies...
if not exist "node_modules" (
    echo [*] Installing build tools...
    call npm install
)

echo.
echo [*] Building obfuscated standalone binaries...
call node build/build.js

echo.
echo ======================================================
echo Build finished! Check the dist\ folder:
echo   - dist\RemoteAssist-Client.exe
echo   - dist\RemoteAssist-Host.exe
echo ======================================================
echo.
pause
