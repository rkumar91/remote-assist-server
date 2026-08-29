@echo off
setlocal
cd /d "%~dp0"

echo ======================================================
echo  RemoteAssist Commercial Native Packager
echo ======================================================

set "CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" (
    set "CSC=C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)

if not exist "dist" mkdir "dist"

echo [1/2] Compiling RemoteAssist-QuickSupport.exe (Client)...
"%CSC%" /target:winexe /out:"dist\RemoteAssist-QuickSupport.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /optimize+ "native_client\QuickSupport.cs" >nul

echo [2/2] Compiling RemoteAssist-Technician.exe (Host Dashboard)...
"%CSC%" /target:winexe /out:"dist\RemoteAssist-Technician.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /optimize+ "native_host\Technician.cs" >nul

echo.
echo ======================================================
echo  SUCCESS! Ultra-Lightweight Commercial Executables Ready:
echo  - dist\RemoteAssist-QuickSupport.exe  (~22 KB)
echo  - dist\RemoteAssist-Technician.exe    (~21 KB)
echo ======================================================
if "%~1"=="" pause
