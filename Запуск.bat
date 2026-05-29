@echo off
cd /d "%~dp0"

if exist "..\Публичный портфель\python\config.json" if not exist "config.json" (
  copy "..\Публичный портфель\python\config.json" "config.json"
)
if not exist "config.json" if exist "config.example.json" copy "config.example.json" "config.json"

set PORT=5500
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr LISTENING') do taskkill /F /PID %%p >nul 2>&1
timeout /t 1 /nobreak >nul
start "" /B python server.py
timeout /t 1 /nobreak >nul

start "" "http://127.0.0.1:%PORT%/index.html"
