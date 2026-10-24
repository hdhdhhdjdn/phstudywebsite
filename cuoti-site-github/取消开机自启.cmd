@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=[IO.Path]::Combine($env:APPDATA,'Microsoft\Windows\Start Menu\Programs\Startup\CuotiServer.lnk'); if (Test-Path $p) { Remove-Item $p -Force; Write-Host 'Autostart removed.' } else { Write-Host 'No autostart shortcut found.' }"
pause
