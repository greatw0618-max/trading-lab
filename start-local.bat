@echo off
rem Double-click to open the dashboard at http://localhost:8765/ (keep the window open while using it).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\serve.ps1"
pause
