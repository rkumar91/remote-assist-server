@echo off
:: ============================================================
::  SYNC_CLIENT_APP.bat
::  Syncs latest code changes into the client_app/ folder.
:: ============================================================

cd /d "%~dp0"
setlocal

echo ============================================================
echo   Syncing updates into client_app/ ...
echo ============================================================

:: 1. Ensure client_app exists
if not exist "client_app" (
    echo Creating client_app directory...
    mkdir "client_app"
)

:: 2. Copy scripts and binaries
copy /Y "end_user\agent.js"               "client_app\agent.js"               >nul
copy /Y "end_user\START_END_USER.bat"      "client_app\START_END_USER.bat"      >nul
copy /Y "end_user\START_END_USER.command"  "client_app\START_END_USER.command"  >nul
copy /Y "end_user\mac_helper.py"           "client_app\mac_helper.py"           >nul
copy /Y "end_user\STOP_END_USER.bat"       "client_app\STOP_END_USER.bat"       >nul
copy /Y "end_user\package.json"            "client_app\package.json"            >nul

if exist "end_user\RemoteCapture.exe" copy /Y "end_user\RemoteCapture.exe" "client_app\RemoteCapture.exe" >nul
if exist "end_user\RemoteInput.exe"   copy /Y "end_user\RemoteInput.exe"   "client_app\RemoteInput.exe"   >nul
if exist "end_user\screen_capture.cs" copy /Y "end_user\screen_capture.cs" "client_app\screen_capture.cs" >nul
if exist "end_user\input_injector.cs" copy /Y "end_user\input_injector.cs" "client_app\input_injector.cs" >nul

:: 3. Sync UI directory
if exist "end_user\ui" (
    if not exist "client_app\ui" mkdir "client_app\ui"
    xcopy /E /Y /Q "end_user\ui\*" "client_app\ui\" >nul
)

:: 4. Regenerate client_app.zip
echo Updating client_app.zip ...
powershell -Command "if (Test-Path 'client_app.zip') { Remove-Item 'client_app.zip' }; Compress-Archive -Path 'client_app\*' -DestinationPath 'client_app.zip' -Force"

echo.
echo [SUCCESS] client_app/ and client_app.zip are up-to-date with your latest Windows and macOS cross-platform code!
echo ============================================================
echo.

endlocal
pause
