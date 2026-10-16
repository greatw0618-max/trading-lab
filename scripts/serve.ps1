# Serves the dashboard at http://localhost:8765/ so it can be used without GitHub Pages.
# Also relays chat questions to the local Claude Code CLI (your Claude subscription, no API key),
# with every Claude Code tool disabled so it can only write text answers.
# Close this window (or press Ctrl+C) to stop the server.
param([int]$Port = 8765, [switch]$NoBrowser)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Origin = "http://localhost:$Port"
$types = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.md' = 'text/plain; charset=utf-8' }

function Find-Claude {
  $c = Get-Command claude -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $dirs = @("$env:APPDATA\Claude\claude-code")
  $dirs += Get-ChildItem "$env:LOCALAPPDATA\Packages" -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'LocalCache\Roaming\Claude\claude-code' }
  $exe = $dirs | Where-Object { Test-Path $_ } | ForEach-Object { Get-ChildItem $_ -Recurse -Filter 'claude.exe' -ErrorAction SilentlyContinue } | Sort-Object LastWriteTime | Select-Object -Last 1
  if ($exe) { return $exe.FullName }
  return $null
}
$Claude = Find-Claude

function Send-Text($ctx, [int]$code, [string]$type, [string]$text) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($text)
  $ctx.Response.StatusCode = $code
  $ctx.Response.ContentType = $type
  $ctx.Response.Headers.Add('Cache-Control', 'no-store')
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.Close()
}

# Runs in a background runspace so the page keeps loading while an answer streams.
$askScript = {
  param($ctx, $exe)
  $res = $ctx.Response
  $p = $null
  $out = $res.OutputStream
  $send = { param($s) $b = [Text.Encoding]::UTF8.GetBytes([string]$s); $out.Write($b, 0, $b.Length); $out.Flush() }
  $errMark = [string][char]1 + 'ERR:'
  try {
    $reader = New-Object IO.StreamReader($ctx.Request.InputStream, [Text.Encoding]::UTF8)
    $body = $reader.ReadToEnd() | ConvertFrom-Json
    $res.ContentType = 'text/plain; charset=utf-8'
    $res.SendChunked = $true
    $res.Headers.Add('Cache-Control', 'no-store')
    if (-not $exe) { & $send ($errMark + 'NOT_FOUND'); return }
    $work = Join-Path $env:TEMP 'slab-chat'
    New-Item -ItemType Directory -Force $work | Out-Null
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $exe
    $psi.Arguments = '-p --output-format stream-json --include-partial-messages --verbose --tools "" --strict-mcp-config --disable-slash-commands --no-session-persistence --effort medium --system-prompt "You are a chart-analysis tutor embedded in a trading dashboard. Follow the instructions at the top of the user message and answer in Korean."'
    $psi.WorkingDirectory = $work
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
    $p = [Diagnostics.Process]::Start($psi)
    $errTask = $p.StandardError.ReadToEndAsync()
    $bytes = [Text.Encoding]::UTF8.GetBytes([string]$body.prompt)
    $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $p.StandardInput.Close()
    $gotText = $false; $final = $null
    while ($null -ne ($line = $p.StandardOutput.ReadLine())) {
      if (-not $line.StartsWith('{')) { continue }
      try { $j = $line | ConvertFrom-Json } catch { continue }
      if ($j.type -eq 'stream_event' -and $j.event.type -eq 'content_block_delta' -and $j.event.delta.type -eq 'text_delta') {
        & $send $j.event.delta.text; $gotText = $true
      } elseif ($j.type -eq 'result') { $final = $j }
    }
    $p.WaitForExit()
    $err = $errTask.Result
    if ($final -and $final.is_error) { & $send ("`n" + $errMark + [string]$final.result) }
    elseif (-not $gotText -and $final -and $final.result) { & $send ([string]$final.result) }
    elseif (-not $gotText) { & $send ($errMark + ([string]$err).Trim()) }
  } catch {
    try { & $send ($errMark + $_.Exception.Message) } catch {}
  } finally {
    if ($p -and -not $p.HasExited) { try { $p.Kill() } catch {} }
    try { $res.Close() } catch {}
  }
}

$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("$Origin/")
try { $l.Start() } catch { Write-Host "Port $Port is already in use. The dashboard may already be running: $Origin/"; exit 1 }
$pool = [runspacefactory]::CreateRunspacePool(1, 4)
$pool.Open()
$jobs = New-Object System.Collections.ArrayList
$statusCache = $null; $statusAt = [datetime]::MinValue

Write-Host "Dashboard running: $Origin/"
if ($Claude) { Write-Host "Chat: using Claude Code at $Claude" } else { Write-Host "Chat: Claude Code not found (free chat mode unavailable)" }
Write-Host "Keep this window open while you use it. Close it to stop."
if (-not $NoBrowser) { Start-Process "$Origin/" }

# Pull the data that GitHub Actions refreshes (stock bars, leaderboard) at most every 30 minutes,
# so the local dashboard is as fresh as the GitHub Pages one. Skipped quietly if git or the remote is unavailable.
$git = Get-Command git -ErrorAction SilentlyContinue
$lastPull = [datetime]::MinValue
function Update-FromGitHub {
  if (-not $git -or -not (Test-Path (Join-Path $Root '.git'))) { return }
  try { & $git.Source -C $Root pull --ff-only --quiet 2>$null | Out-Null; Write-Host ("Data synced from GitHub at " + (Get-Date -Format 'HH:mm')) } catch {}
}
Update-FromGitHub; $lastPull = Get-Date

# Record start/stop in a small log so a server that disappears can be diagnosed later.
$logFile = Join-Path $env:TEMP 'maemae-server.log'
function Write-Log($m) { try { Add-Content -Path $logFile -Value ((Get-Date -Format 's') + ' ' + $m) } catch {} }
Write-Log "started (pid $PID)"
Register-EngineEvent PowerShell.Exiting -Action { Add-Content -Path (Join-Path $env:TEMP 'maemae-server.log') -Value ((Get-Date -Format 's') + ' exiting') } | Out-Null

while ($l.IsListening) {
  # Wait for requests in short slices instead of blocking forever, so the process keeps responding to Windows.
  $pending = $l.GetContextAsync()
  while (-not $pending.Wait(500)) { }
  $ctx = $pending.Result
  if (((Get-Date) - $lastPull).TotalMinutes -ge 30) { $lastPull = Get-Date; Update-FromGitHub }
  # Clean up finished chat jobs
  for ($k = $jobs.Count - 1; $k -ge 0; $k--) { if ($jobs[$k].h.IsCompleted) { try { $jobs[$k].ps.EndInvoke($jobs[$k].h) } catch {}; $jobs[$k].ps.Dispose(); $jobs.RemoveAt($k) } }
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($path.StartsWith('api/')) {
      # Only this page may call the chat API: other websites cannot set this header without a CORS preflight, which is never answered.
      $o = $ctx.Request.Headers['Origin']
      if ($ctx.Request.Headers['X-Dashboard'] -ne '1' -or ($o -and $o -ne $Origin)) { Send-Text $ctx 403 'text/plain; charset=utf-8' 'forbidden'; continue }
      if ($path -eq 'api/proxy/okx') {
        # OKX public market statistics do not allow direct browser requests (no CORS), so they are relayed here.
        # Only read-only public paths are allowed.
        $q = [string]$ctx.Request.QueryString['path']
        if (-not ($q -match '^/api/v5/(rubik/stat|public|market)/[A-Za-z0-9/_\-]+(\?[A-Za-z0-9=&_\-\.]*)?$')) { Send-Text $ctx 400 'text/plain; charset=utf-8' 'path not allowed'; continue }
        try {
          $wc = New-Object Net.WebClient; $wc.Encoding = [Text.Encoding]::UTF8
          $wc.Headers.Add('User-Agent', 'Mozilla/5.0')
          Send-Text $ctx 200 'application/json; charset=utf-8' ($wc.DownloadString('https://www.okx.com' + $q))
        } catch { Send-Text $ctx 502 'text/plain; charset=utf-8' 'okx unavailable' }
        continue
      }
      if ($path -eq 'api/proxy/bitfinex') {
        # Bitfinex public trade history has no CORS either; only the read-only trades history path is allowed.
        $q = [string]$ctx.Request.QueryString['path']
        if (-not ($q -match '^/v2/trades/t[A-Z0-9:]+/hist(\?[A-Za-z0-9=&_\-\.]*)?$')) { Send-Text $ctx 400 'text/plain; charset=utf-8' 'path not allowed'; continue }
        try {
          $wc = New-Object Net.WebClient; $wc.Encoding = [Text.Encoding]::UTF8; $wc.Headers.Add('User-Agent', 'Mozilla/5.0')
          Send-Text $ctx 200 'application/json; charset=utf-8' ($wc.DownloadString('https://api-pub.bitfinex.com' + $q))
        } catch { Send-Text $ctx 502 'text/plain; charset=utf-8' 'bitfinex unavailable' }
        continue
      }
      if ($path -eq 'api/version') {
        # Newest change time of the page files, so open pages can reload themselves after an update.
        $files = @(Get-Item (Join-Path $Root 'index.html')) + @(Get-ChildItem (Join-Path $Root 'js'), (Join-Path $Root 'css') -File)
        $v = ($files | Measure-Object -Property LastWriteTimeUtc -Maximum).Maximum.Ticks
        Send-Text $ctx 200 'application/json; charset=utf-8' ('{"v":"' + $v + '"}'); continue
      }
      if ($path -eq 'api/ask/status') {
        if (-not $statusCache -or ((Get-Date) - $statusAt).TotalSeconds -gt 20 -or $ctx.Request.QueryString['refresh']) {
          $logged = $false
          if ($Claude) { try { $st = (& $Claude auth status 2>$null) -join "`n" | ConvertFrom-Json; $logged = [bool]$st.loggedIn } catch {} }
          $statusCache = (@{ available = [bool]$Claude; loggedIn = $logged } | ConvertTo-Json -Compress); $statusAt = Get-Date
        }
        Send-Text $ctx 200 'application/json; charset=utf-8' $statusCache; continue
      }
      if ($path -eq 'api/login' -and $ctx.Request.HttpMethod -eq 'POST') {
        if ($Claude) { Start-Process -FilePath $Claude -ArgumentList 'auth', 'login' }
        $statusCache = $null
        Send-Text $ctx 200 'application/json; charset=utf-8' '{"started":true}'; continue
      }
      if (($path -eq 'api/report/save' -or $path -eq 'api/save') -and $ctx.Request.HttpMethod -eq 'POST') {
        # Saves one record as <kind>/<id>.json and keeps <kind>/index.json in sync.
        # kind: reports (리포트 탭), trades (매매 테스트), reviews (매매 테스트 전체 분석)
        try {
          $kind = if ($path -eq 'api/report/save') { 'reports' } else { [string]$ctx.Request.QueryString['kind'] }
          if (@('reports', 'trades', 'reviews') -notcontains $kind) { Send-Text $ctx 400 'text/plain; charset=utf-8' 'bad kind'; continue }
          $reader = New-Object IO.StreamReader($ctx.Request.InputStream, [Text.Encoding]::UTF8)
          $raw = $reader.ReadToEnd()
          $rep = $raw | ConvertFrom-Json
          $id = [string]$rep.id
          if (-not ($id -match '^[0-9]{8}-[0-9]{6}-[A-Za-z0-9]{1,20}$')) { Send-Text $ctx 400 'text/plain; charset=utf-8' 'bad id'; continue }
          $dir = Join-Path $Root $kind
          New-Item -ItemType Directory -Force $dir | Out-Null
          [IO.File]::WriteAllText((Join-Path $dir "$id.json"), $raw, (New-Object Text.UTF8Encoding $false))
          $idxFile = Join-Path $dir 'index.json'
          $list = @()
          if (Test-Path $idxFile) { try { $list = @(([IO.File]::ReadAllText($idxFile, [Text.Encoding]::UTF8) | ConvertFrom-Json).reports) } catch { $list = @() } }
          $entry = [ordered]@{ id = $id; sym = $rep.sym; created = $rep.created; direction = $rep.plan.direction; confidence = $rep.plan.confidence; status = $(if ($rep.result) { $rep.result.status } else { $null }) }
          $list = @($list | Where-Object { $_.id -ne $id }) + @([pscustomobject]$entry)
          $json = ConvertTo-Json -InputObject ([ordered]@{ reports = @($list | Sort-Object id -Descending) }) -Depth 5 -Compress
          [IO.File]::WriteAllText($idxFile, $json, (New-Object Text.UTF8Encoding $false))
          # Upload the report to GitHub in the background so the online dashboard (GitHub Pages) shows it too.
          if ($git -and (Test-Path (Join-Path $Root '.git'))) {
            $g = $git.Source
            # A named mutex keeps several uploads (e.g. many results scored at once) from running git at the same time.
            $cmd = "`$m = New-Object Threading.Mutex(`$false, 'MaemaeLabReportGit'); [void]`$m.WaitOne(); try { & '$g' -C '$Root' add -- $kind/$id.json $kind/index.json; & '$g' -C '$Root' commit -q -m 'Save $kind $id' -- $kind/$id.json $kind/index.json; & '$g' -C '$Root' pull --rebase --autostash -q origin main; & '$g' -C '$Root' push -q origin main } finally { `$m.ReleaseMutex() }"
            Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', $cmd
          }
          Send-Text $ctx 200 'application/json; charset=utf-8' '{"saved":true}'
        } catch { Send-Text $ctx 500 'text/plain; charset=utf-8' ('save failed: ' + $_.Exception.Message) }
        continue
      }
      if ($path -eq 'api/ask' -and $ctx.Request.HttpMethod -eq 'POST') {
        $ps = [powershell]::Create(); $ps.RunspacePool = $pool
        [void]$ps.AddScript($askScript).AddArgument($ctx).AddArgument($Claude)
        [void]$jobs.Add(@{ ps = $ps; h = $ps.BeginInvoke() })
        continue
      }
      Send-Text $ctx 404 'text/plain; charset=utf-8' 'not found'; continue
    }
    if ($path -eq '') { $path = 'index.html' }
    $file = Join-Path $Root $path
    if ((Test-Path $file -PathType Leaf) -and ((Resolve-Path $file).Path.StartsWith($Root))) {
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $ctx.Response.ContentType = $(if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' })
      $ctx.Response.Headers.Add('Cache-Control', 'no-store')
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else { $ctx.Response.StatusCode = 404 }
    $ctx.Response.Close()
  } catch { try { $ctx.Response.StatusCode = 500; $ctx.Response.Close() } catch {} }
}
