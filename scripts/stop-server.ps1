# Stops the dashboard server (any PowerShell process running serve.ps1).
$procs = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" | Where-Object { $_.CommandLine -like '*serve.ps1*' })
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
if ($procs.Count) { Write-Host "Dashboard server stopped." } else { Write-Host "Dashboard server was not running." }
