@echo off
REM Expose the whole site (app + API) with ONE Cloudflare quick-tunnel URL.
REM The backend already serves the built site (client/dist), so tunneling
REM port 5000 alone is enough. No account needed. Keep this window open.
REM
REM Usage:  expose-site.bat
REM Then open the printed https://xxx.trycloudflare.com URL on any device.

set "WORKDIR=%~dp0"
set "CF=%USERPROFILE%\.cloudflared\cloudflared.exe"

if not exist "%CF%" (
  echo [expose] downloading cloudflared to %CF% ...
  if not exist "%USERPROFILE%\.cloudflared" mkdir "%USERPROFILE%\.cloudflared"
  curl.exe -L --retry 3 -o "%CF%" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
  if errorlevel 1 (
    echo [expose] Download failed. Get it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    exit /b 1
  )
)

REM Kill any tunnel left over from an earlier run. A quick tunnel that has been
REM reclaimed answers "Unauthorized: Tunnel not found" forever, so a stale
REM cloudflared keeps running and keeps looking like it works while routing
REM nothing.
taskkill /F /IM cloudflared.exe >nul 2>&1

echo [expose] Make sure the backend is running first:
echo [expose]   npm --prefix "%WORKDIR%backend" start
echo.
echo [expose] If you changed client code, rebuild the served site too:
echo [expose]   npm --prefix "%WORKDIR%client" run build
echo [expose]   (no env vars needed - client\.env.production sets /api + / for you)
echo.

REM 127.0.0.1, NOT localhost: cloudflared resolves "localhost" to IPv6 ::1 first
REM on Windows, and this backend listens on IPv4 only - so the tunnel comes up,
REM prints a URL, and then fails every request with
REM "Unable to reach the origin service ... dial tcp [::1]:5000".
echo [expose] Starting tunnel for http://127.0.0.1:5000 ...
"%CF%" tunnel --no-autoupdate --url http://127.0.0.1:5000
