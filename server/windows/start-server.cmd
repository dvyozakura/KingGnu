@echo off
rem ============================================================
rem  KingGnu online battle server (no window needed: use start-hidden.vbs)
rem  - listens on 127.0.0.1:%PORT% (reachable only through Cloudflare Tunnel)
rem  - restarts automatically if it crashes
rem  - log: server\logs\server.log
rem ============================================================
setlocal
cd /d "%~dp0..\.."
if not defined PORT set PORT=8787
set HOST=127.0.0.1
set ALLOWED_ORIGINS=https://dvyozakura.github.io,http://localhost:5173
if not exist "server\logs" mkdir "server\logs"

rem already running? then do nothing
netstat -ano | findstr /r /c:"127.0.0.1:%PORT% .*LISTENING" >nul && (
  echo KingGnu server is already running on port %PORT%.
  exit /b 0
)

rem always rebuild so the latest code is used (takes ~1s)
echo [%date% %time%] building server... >> "server\logs\server.log"
call npm.cmd run build:server >> "server\logs\server.log" 2>&1

del /q "server\logs\stop.flag" 2>nul
:loop
echo [%date% %time%] starting server on 127.0.0.1:%PORT% >> "server\logs\server.log"
node "server\dist\server.mjs" >> "server\logs\server.log" 2>&1
if exist "server\logs\stop.flag" goto end
echo [%date% %time%] server exited, restarting in 3s >> "server\logs\server.log"
timeout /t 3 /nobreak >nul
goto loop
:end
del /q "server\logs\stop.flag" 2>nul
echo [%date% %time%] stopped >> "server\logs\server.log"
endlocal
