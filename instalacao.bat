@echo off
setlocal
rem Installs the wmux build made by "npm run make" (Squirrel installer).
rem Run it from the repository folder. Build first with: npm run make

set "SETUP="
for %%F in ("%~dp0out\make\squirrel.windows\x64\wmux-*.Setup.exe") do set "SETUP=%%~fF"

if not defined SETUP (
  echo No installer found in out\make\squirrel.windows\x64.
  echo Build it first with: npm run make
  pause
  exit /b 1
)

echo Installer: %SETUP%
echo.
echo wmux will be closed so the new version can be installed.
echo Panes kept by the background daemon survive the restart.
echo.
choice /m "Close wmux and install now"
if errorlevel 2 exit /b 0

taskkill /im wmux.exe /f >nul 2>&1
timeout /t 2 /nobreak >nul

"%SETUP%"
if errorlevel 1 (
  echo Installer exited with an error.
  pause
  exit /b 1
)

echo.
echo Done. wmux starts by itself; if not, open it from the Start menu.
pause
