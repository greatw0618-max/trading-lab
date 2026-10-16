# Stops the dashboard server and pauses the watchdog task, so it stays off until "start" is used again.
$task = 'MaemaeLab Dashboard Server'
if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) { Disable-ScheduledTask -TaskName $task | Out-Null }
$procs = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" | Where-Object { $_.CommandLine -like '*serve.ps1*' })
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
if ($procs.Count) { Write-Host "Dashboard server stopped (auto-restart paused)." } else { Write-Host "Dashboard server was not running (auto-restart paused)." }
