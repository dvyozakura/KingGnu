@echo off
rem Stop the KingGnu server started by start-server.cmd / start-hidden.vbs
setlocal
cd /d "%~dp0..\.."
if not defined PORT set PORT=8787
if not exist "server\logs" mkdir "server\logs"
echo stop> "server\logs\stop.flag"
set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"127.0.0.1:%PORT% .*LISTENING"') do (
  taskkill /PID %%p /F >nul 2>&1
  set FOUND=1
)
if defined FOUND (echo KingGnu server stopped.) else (echo KingGnu server was not running.)
timeout /t 2 >nul
endlocal
