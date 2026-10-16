@echo off
chcp 65001 >nul
wscript.exe "%~dp0scripts\start-hidden.vbs"
echo 매매연구소 대시보드 서버를 켰습니다. 잠시 후 브라우저가 열립니다.
timeout /t 3 /nobreak >nul
start "" "http://localhost:8765/"
