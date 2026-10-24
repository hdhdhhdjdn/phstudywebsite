@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

set "NODE=C:\Users\lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if exist "%NODE%" goto run

where node >nul 2>nul
if not errorlevel 1 (
  set "NODE=node"
  goto run
)

echo [ERROR] Node.js not found.
echo Please double-click "cuoti.html" (single file version) instead.
pause
exit /b 1

:run
echo.
echo  Starting local server: http://localhost:8765/
echo  Keep this window open. Close it to stop the server.
echo.
start "Cuoti server (close to stop)" "%NODE%" server.js 8765
timeout /t 2 >nul
start "" http://localhost:8765/
exit /b 0
