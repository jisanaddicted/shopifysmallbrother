@echo off
REM Expose the Vite dev server (port 5173) via Cloudflare.
REM Use this INSTEAD of expose-backend.bat when you want the other device to
REM hit the dev server directly. Backend .env CLIENT_ORIGIN already allows
REM *.trycloudflare.com, so no backend change is needed.
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo [expose] cloudflared not found. Installing via winget...
  winget install -e --id Cloudflare.cloudflared
  if errorlevel 1 (
    echo [expose] Install failed. Get it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    exit /b 1
  )
)

echo [expose] Starting tunnel for http://localhost:5173 ...
cloudflared tunnel --url http://localhost:5173
