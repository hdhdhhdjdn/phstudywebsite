@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo   错题站 · 服务器状态检查
echo   ========================================
netstat -ano | findstr ":8765" | findstr "LISTENING" >nul
if errorlevel 1 (
  echo   [x] 端口 8765 没有程序在监听  =  服务器没在运行
  echo.
  echo   请双击「启动（班级版）.cmd」启动服务，
  echo   并保持那个黑色窗口一直开着（关掉窗口 = 停止服务）。
  echo.
  pause
  exit /b 1
)

set "SRVPID="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8765" ^| findstr "LISTENING"') do set "SRVPID=%%a"
echo   [ok] 服务器正在运行   PID: !SRVPID!
echo.
echo   本机访问：   http://localhost:8765/
powershell -NoProfile -Command "$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue ^| Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notlike '*Loopback*' } ^| Select-Object -ExpandProperty IPAddress; if ($ips) { foreach ($ip in $ips) { Write-Host ('   iPad / 同学访问： http://' + $ip + ':8765/') } } else { Write-Host '   [提示] 没检测到局域网 IP' }"
echo.
start "" http://localhost:8765/
echo   已在本机打开浏览器。
echo.
pause
