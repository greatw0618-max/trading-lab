@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-server.ps1"
echo 매매연구소 대시보드 서버를 껐습니다. 자동 재시작도 멈췄습니다. 다시 켜려면 start-local.bat를 더블클릭하세요.
timeout /t 5 >nul
