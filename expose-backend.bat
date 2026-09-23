@echo off
REM Expose this machine's backend (port 5000) via a Cloudflare quick tunnel.
REM No account needed. The printed https://*.trycloudflare.com URL works from
REM any device. Keep this window open while sharing.
REM
REM Usage:  expose-backend.bat
REM Then:   npm --prefix client run dev:tunnel   (in another terminal,
REM           paste the tunnel URL when asked)

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo [expose] cloudflared not found. Installing via winget...
  winget install -e --id Cloudflare.cloudflared
  if errorlevel 1 (
    echo [expose] Install failed. Get it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    exit /b 1
  )
)

echo [expose] Starting tunnel for http://localhost:5000 ...
cloudflared tunnel --url http://localhost:5000
