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

echo [expose] Make sure the backend is running first:
echo [expose]   npm --prefix "%WORKDIR%backend" start
echo.
echo [expose] If you changed client code, rebuild the served site too:
echo [expose]   npm --prefix "%WORKDIR%client" run build
echo [expose]   (no env vars needed - client\.env.production sets /api + / for you)
echo.
echo [expose] Starting tunnel for http://localhost:5000 ...
"%CF%" tunnel --url http://localhost:5000
