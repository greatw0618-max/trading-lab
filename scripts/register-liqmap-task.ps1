# 청산맵 자료 수집 예약 작업을 등록합니다 (15분마다, 창 없이). "청산맵 수집 켜기.bat"이 이 파일을 실행합니다.
$vbs = Join-Path $PSScriptRoot 'liqmap-collect.vbs'
$act = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $vbs + '"')
$t0 = (Get-Date).Date.AddHours((Get-Date).Hour).AddMinutes(16)
$trg = New-ScheduledTaskTrigger -Once -At $t0 -RepetitionInterval (New-TimeSpan -Minutes 15)
$set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 12) -MultipleInstances IgnoreNew
$pr = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
Register-ScheduledTask -TaskName 'MaemaeLab LiqMap Collect' -Action $act -Trigger $trg -Settings $set -Principal $pr -Description '청산맵 자료(5개 거래소 OI)를 15분마다 모읍니다. 3시간마다 GitHub에 올립니다.' -Force | Out-Null
Start-ScheduledTask -TaskName 'MaemaeLab LiqMap Collect'
Write-Host '청산맵 자료 수집을 켰습니다 (15분마다). 끄려면 작업 스케줄러에서 "MaemaeLab LiqMap Collect"를 사용 안 함으로 바꾸세요.'
