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
pause
exit /b 1

:run
echo.
echo  Starting CLASS server (accounts + shared question bank)
echo  Keep this window open. Closing it stops the server.
echo.
start "Cuoti class server (close to stop)" "%NODE%" cloud-server.js
timeout /t 2 >nul
start "" http://localhost:8765/
exit /b 0
