@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-server.ps1"
echo 매매연구소 대시보드 서버를 켰습니다. (꺼지면 5분 안에 자동으로 다시 켜집니다) 잠시 후 브라우저가 열립니다.
timeout /t 3 /nobreak >nul
start "" "http://localhost:8765/"
