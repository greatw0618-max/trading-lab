# Turns the watchdog task back on and starts the dashboard server right away (hidden).
$task = 'MaemaeLab Dashboard Server'
if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) { Enable-ScheduledTask -TaskName $task | Out-Null }
Start-Process wscript.exe -ArgumentList ('"' + (Join-Path $PSScriptRoot 'start-hidden.vbs') + '"')
Write-Host "Dashboard server started (auto-restart on)."
