@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

echo Starting the JobRight helper.
echo Screenshots will be saved in %%USERPROFILE%%\Desktop\SS
node blocklist_server.mjs

echo.
echo The JobRight helper stopped.
pause
