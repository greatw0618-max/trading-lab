# Runs every morning before 9:00 (scheduled task "MaemaeLab Morning Report").
# The 9:00 BTC/ETH reports are written by the dashboard page itself, so a page must be open.
# If no dashboard page has polled the server in the last 3 minutes, open one in the default browser.
$url = 'http://localhost:8765/'
$ago = -1
for ($i = 0; $i -lt 12; $i++) {  # the server may still be starting (watchdog restarts it within 5 min)
  try { $ago = (Invoke-RestMethod -Uri ($url + 'api/page/alive') -Headers @{ 'X-Dashboard' = '1' } -TimeoutSec 5).ago; break } catch { Start-Sleep -Seconds 20 }
}
# Only during the 9:00~12:00 report window (the task also runs late if the PC was off at 8:48).
if ((Get-Date).Hour -lt 12 -and ($ago -lt 0 -or $ago -gt 180)) { Start-Process $url }
