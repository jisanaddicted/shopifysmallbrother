@echo off
REM Starts the API detached from the backend\ folder (cwd matters: it runs
REM src\server.js). The payment URLs are pointed at the live Cloudflare quick
REM tunnel instead of the stale values in backend\.env - dotenv does NOT
REM override real environment variables, so these two win. Logs land in
REM backend-now.out.log / backend-now.err.log next to this script.
cd /d "%~dp0backend"
set "TUNNEL_URL=https://carlo-compiler-calgary-tells.trycloudflare.com"
set "BACKEND_URL=%TUNNEL_URL%"
set "CLIENT_URL=%TUNNEL_URL%"
start "" /b cmd /c node src\server.js 1^> "%~dp0backend-now.out.log" 2^> "%~dp0backend-now.err.log"
exit /b 0