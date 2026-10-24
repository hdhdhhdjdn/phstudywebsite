@echo off
set "VBS=%~dp0start-hidden.vbs"
if not exist "%VBS%" (
  echo [ERROR] start-hidden.vbs not found.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell; $p=[IO.Path]::Combine($env:APPDATA,'Microsoft\Windows\Start Menu\Programs\Startup\CuotiServer.lnk'); $s=$ws.CreateShortcut($p); $s.TargetPath='%VBS%'; $s.WorkingDirectory='%~dp0'; $s.Save(); Write-Host ('Startup shortcut created: ' + $p)"
echo.
echo Done. The server will start automatically after you log in to Windows.
pause
