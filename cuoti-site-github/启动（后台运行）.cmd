@echo off
cd /d "%~dp0"
start "" wscript.exe "%~dp0start-hidden.vbs"
timeout /t 2 >nul
start "" http://localhost:8765/
exit /b 0
