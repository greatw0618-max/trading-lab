# Downloads stock bars (Yahoo Finance) and the Hyperliquid leaderboard into data/*.json.
# Runs on GitHub Actions (pwsh 7) and Windows PowerShell 5.1.
# 15m and 1h bars are merged into the existing files, so history grows past Yahoo's 60-day 15m limit.
param(
  [string]$DataDir = (Join-Path (Join-Path $PSScriptRoot '..') 'data'),
  [switch]$SkipLeaderboard
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Force $DataDir | Out-Null
$DataDir = (Resolve-Path $DataDir).Path
$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

$Symbols = @('SOXL', 'KORU', 'SOXX', 'EWY')
$Jobs = @(
  @{ Interval = '15m'; Query = 'range=60d&interval=15m'; Merge = $true },
  @{ Interval = '1h';  Query = 'range=730d&interval=1h'; Merge = $true },
  @{ Interval = '1d';  Query = 'period1=0&period2={now}&interval=1d'; Merge = $false }
)

function Save-Json($Path, $Obj) {
  $json = $Obj | ConvertTo-Json -Depth 6 -Compress
  [IO.File]::WriteAllText($Path, $json, (New-Object Text.UTF8Encoding $false))
}

function Get-Yahoo($Symbol, $Query) {
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $q = $Query.Replace('{now}', "$now")
  $url = "https://query1.finance.yahoo.com/v8/finance/chart/$Symbol`?$q&includePrePost=false"
  for ($try = 1; $try -le 3; $try++) {
    try { return (Invoke-RestMethod $url -UserAgent $UA -TimeoutSec 60).chart.result[0] }
    catch { if ($try -eq 3) { throw }; Start-Sleep -Seconds (5 * $try) }
  }
}

$log = @()
foreach ($sym in $Symbols) {
  foreach ($job in $Jobs) {
    $file = Join-Path $DataDir ("{0}_{1}.json" -f $sym, $job.Interval)
    try {
      $r = Get-Yahoo $sym $job.Query
      $q = $r.indicators.quote[0]
      $bars = [ordered]@{}
      if ($job.Merge -and (Test-Path $file)) {
        $old = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json
        for ($i = 0; $i -lt $old.t.Count; $i++) {
          $bars["$($old.t[$i])"] = @($old.t[$i], $old.o[$i], $old.h[$i], $old.l[$i], $old.c[$i], $old.v[$i])
        }
      }
      for ($i = 0; $i -lt $r.timestamp.Count; $i++) {
        if ($null -eq $q.close[$i] -or $null -eq $q.open[$i]) { continue }
        $t = [long]$r.timestamp[$i]
        $bars["$t"] = @($t, [math]::Round($q.open[$i], 4), [math]::Round($q.high[$i], 4), [math]::Round($q.low[$i], 4), [math]::Round($q.close[$i], 4), [long]($q.volume[$i]))
      }
      $rows = $bars.Values | Sort-Object { $_[0] }
      $out = [ordered]@{
        symbol = $sym; interval = $job.Interval; tz = $r.meta.exchangeTimezoneName
        updated = [DateTimeOffset]::UtcNow.ToString('o')
        t = @($rows | ForEach-Object { $_[0] }); o = @($rows | ForEach-Object { $_[1] }); h = @($rows | ForEach-Object { $_[2] })
        l = @($rows | ForEach-Object { $_[3] }); c = @($rows | ForEach-Object { $_[4] }); v = @($rows | ForEach-Object { $_[5] })
      }
      Save-Json $file $out
      $log += "$sym $($job.Interval): $($rows.Count) bars"
    } catch {
      $log += "$sym $($job.Interval): FAILED ($($_.Exception.Message)) - kept previous file"
    }
    Start-Sleep -Milliseconds 800
  }
}

if (-not $SkipLeaderboard) {
  try {
    # The raw leaderboard is ~40MB, so only top traders are kept.
    $wc = New-Object Net.WebClient
    $wc.Encoding = [Text.Encoding]::UTF8
    $raw = $wc.DownloadString('https://stats-data.hyperliquid.xyz/Mainnet/leaderboard')
    if ($PSVersionTable.PSVersion.Major -ge 6) { $lb = $raw | ConvertFrom-Json }
    else {
      Add-Type -AssemblyName System.Web.Extensions
      $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
      $ser.MaxJsonLength = [int]::MaxValue
      $lb = @{ leaderboardRows = $ser.DeserializeObject($raw)['leaderboardRows'] }
    }
    $rows = foreach ($r in $lb.leaderboardRows) {
      $w = @{}
      foreach ($p in $r.windowPerformances) { $w[$p[0]] = $p[1] }
      $av = [double]$r.accountValue
      # Skip small accounts and vault/system accounts that did not trade this month.
      if ($av -lt 100000 -or [double]$w['month'].vlm -lt 1000000) { continue }
      [pscustomobject]@{
        a = $r.ethAddress; n = $r.displayName; av = [math]::Round($av)
        dPnl = [math]::Round([double]$w['day'].pnl); wPnl = [math]::Round([double]$w['week'].pnl)
        mPnl = [math]::Round([double]$w['month'].pnl); aPnl = [math]::Round([double]$w['allTime'].pnl)
        mRoi = [math]::Round([double]$w['month'].roi, 4); mVlm = [math]::Round([double]$w['month'].vlm)
      }
    }
    $top = @()
    $top += $rows | Sort-Object mPnl -Descending | Select-Object -First 80
    $top += $rows | Sort-Object aPnl -Descending | Select-Object -First 80
    $top += $rows | Sort-Object av -Descending | Select-Object -First 40
    $seen = @{}; $uniq = foreach ($x in $top) { if (-not $seen[$x.a]) { $seen[$x.a] = 1; $x } }
    Save-Json (Join-Path $DataDir 'leaderboard.json') ([ordered]@{ updated = [DateTimeOffset]::UtcNow.ToString('o'); rows = @($uniq) })
    $log += "leaderboard: $(@($uniq).Count) traders"
  } catch {
    $msg = $_.Exception.Message; if ($msg.Length -gt 200) { $msg = $msg.Substring(0, 200) }
    $log += "leaderboard: FAILED ($msg) - kept previous file"
  }
}

Save-Json (Join-Path $DataDir 'status.json') ([ordered]@{ updated = [DateTimeOffset]::UtcNow.ToString('o'); log = $log })
$log | ForEach-Object { Write-Host $_ }
