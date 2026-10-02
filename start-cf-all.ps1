# Start the WHOLE app behind ONE Cloudflare quick tunnel, in the right order.
#
# Why the order matters: a quick tunnel prints its https://*.trycloudflare.com
# URL within a couple of seconds, and it does NOT care whether the origin is up
# yet - it comes up either way and only fails requests in the meantime. That is
# what makes tunnel-first safe, and it is the ONLY order that works: the backend
# needs to know its own PUBLIC host for the SSLCommerz payment redirects, and
# that host IS the tunnel URL. Backend-first would start the API still pointed at
# whatever stale URL is sitting in backend\.env.
#
# dotenv does NOT override real environment variables, so the BACKEND_URL /
# CLIENT_URL set below win over .env. (start-cf-backend.bat hardcodes one URL,
# which is why it goes stale on every fresh tunnel.)
#
# One tunnel, not two: the backend serves client\dist itself, so exposing port
# 5000 exposes the built site AND /api together - the SPA's relative /api calls
# resolve against the same host with no CORS round trip.
#
# Usage:  powershell -ExecutionPolicy Bypass -File .\start-cf-all.ps1
#
# IMPORTANT: this kills ANY cloudflared already running, including one you may
# have up deliberately. A reclaimed quick tunnel answers "Tunnel not found"
# forever, so a stale process looks healthy while routing nothing.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$cf   = Join-Path $env:USERPROFILE '.cloudflared\cloudflared.exe'

if (-not (Test-Path $cf)) {
  throw "cloudflared not found at $cf - see expose-site.bat, which downloads it."
}

# --- 0. Kill anything left over from an earlier run -------------------------
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'src[\\/]server\.js' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

$tunnelOut = Join-Path $root 'cf-live.out.log'
$tunnelErr = Join-Path $root 'cf-live.err.log'
$beOut     = Join-Path $root 'backend-live.out.log'
$beErr     = Join-Path $root 'backend-live.err.log'
foreach ($f in @($tunnelOut, $tunnelErr, $beOut, $beErr)) {
  if (Test-Path $f) { Remove-Item $f -Force }
}

# --- 1. Tunnel first, purely to learn the public URL -----------------------
# 127.0.0.1 and NOT localhost: cloudflared resolves "localhost" to IPv6 ::1
# first on Windows and the backend listens on IPv4 only, so the tunnel would come
# up, print a URL, then fail every request with
# "Unable to reach the origin ... dial tcp [::1]:5000".
Write-Host '[cf] starting tunnel -> http://127.0.0.1:5000 ...'
$pTunnel = Start-Process -FilePath $cf -ArgumentList 'tunnel --no-autoupdate --url http://127.0.0.1:5000' -WindowStyle Hidden -PassThru -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr

# --- 2. Poll the logs for the URL ------------------------------------------
# cloudflared writes its banner to stderr, so both files are scanned.
$tunnelUrl = $null
$pattern = 'https://[a-z0-9-]+\.trycloudflare\.com'
for ($i = 0; $i -lt 45 -and -not $tunnelUrl; $i++) {
  Start-Sleep -Seconds 1
  foreach ($f in @($tunnelErr, $tunnelOut)) {
    if (Test-Path $f) {
      $raw = Get-Content $f -Raw -ErrorAction SilentlyContinue
      if ($raw) {
        $m = [regex]::Match($raw, $pattern)
        if ($m.Success) { $tunnelUrl = $m.Value; break }
      }
    }
  }
}
if (-not $tunnelUrl) {
  Write-Host '[cf] tunnel never printed a URL. stderr:'
  Get-Content $tunnelErr -Tail 20 -ErrorAction SilentlyContinue
  throw 'no tunnel URL'
}
Write-Host "[cf] tunnel URL: $tunnelUrl"

# --- 3. Backend, told its own public host ----------------------------------
# The child inherits this process's environment, which is the whole point.
$env:BACKEND_URL = $tunnelUrl
$env:CLIENT_URL  = $tunnelUrl
Write-Host '[api] starting backend (cwd must be backend\ - it runs src\server.js) ...'
$pBe = Start-Process -FilePath 'node.exe' -ArgumentList 'src/server.js' -WorkingDirectory (Join-Path $root 'backend') -WindowStyle Hidden -PassThru -RedirectStandardOutput $beOut -RedirectStandardError $beErr

# --- 4. Wait for the API to answer locally ----------------------------------
$ok = $false
for ($i = 0; $i -lt 45 -and -not $ok; $i++) {
  Start-Sleep -Seconds 1
  try {
    if ((Invoke-WebRequest 'http://127.0.0.1:5000/api/health' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $ok = $true }
  } catch {}
}
if (-not $ok) {
  Write-Host '[api] never came up. stderr:'
  Get-Content $beErr -Tail 25 -ErrorAction SilentlyContinue
  throw 'backend down'
}
Write-Host '[api] local health OK'

Write-Host ''
Write-Host '============================================================'
Write-Host "  APP IS LIVE:  $tunnelUrl"
Write-Host '  local:        http://localhost:5000'
Write-Host "  backend pid:  $($pBe.Id)   tunnel pid: $($pTunnel.Id)"
Write-Host '============================================================'
Write-Host 'Open the URL on any device. Keep this host awake.'
Write-Host "Stop:  taskkill /F /IM cloudflared.exe  &  taskkill /F /PID $($pBe.Id)"
Write-Host "Logs:  $tunnelErr | $beOut | $beErr"