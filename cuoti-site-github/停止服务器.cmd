@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "$pids = netstat -ano | Select-String ':8765\s' | Select-String 'LISTENING' | ForEach-Object { ($_ -split '\s+')[-1] } | Select-Object -Unique; if ($pids) { foreach ($id in $pids) { try { Stop-Process -Id $id -Force; Write-Host ('Stopped server PID ' + $id) } catch { Write-Host ('Could not stop PID ' + $id) } } } else { Write-Host 'No server is listening on port 8765.' }"
pause
