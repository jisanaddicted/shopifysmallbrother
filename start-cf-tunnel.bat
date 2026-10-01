@echo off
REM Launches cloudflared detached with its own log file, then exits immediately.
REM The redirect lives INSIDE the child so the file handle survives this script.
cd /d "%~dp0"
start "" /b cmd /c ""%USERPROFILE%\.cloudflared\cloudflared.exe" tunnel --no-autoupdate --url http://localhost:5000 1> "%~dp0cf-now.err.log" 2>&1"
exit /b 0