@echo off
title NexLink Launcher
color 0B
cls

echo.
echo   ============================================
echo     NexLink Launcher
echo   ============================================
echo.

:: ── CHECK NODE ────────────────────────────────────────────────
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   [!] Node.js is not installed.
    echo.
    echo   Please install it from: https://nodejs.org
    echo   Download the "LTS" version, install it, then
    echo   double-click this file again.
    echo.
    pause
    start https://nodejs.org
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo   [OK] Node.js %NODE_VER% found

:: ── INSTALL DEPENDENCIES ──────────────────────────────────────
if not exist "%~dp0node_modules\.install-done" (
    echo.
    echo   [>>] Installing dependencies ^(first run only^)...
    cd /d "%~dp0"
    call npm install --silent
    echo. > "%~dp0node_modules\.install-done"
    echo   [OK] Dependencies installed
)

:: ── FIND FREE PORT ────────────────────────────────────────────
set PORT=3000

:: ── START SERVER ──────────────────────────────────────────────
echo.
echo   ============================================
echo.
echo     NexLink is starting...
echo.
echo     Open this in your browser:
echo       http://localhost:%PORT%
echo.
echo     Opening browser automatically in 2 seconds...
echo.
echo     Press Ctrl+C to stop NexLink
echo.
echo   ============================================
echo.

:: Open browser after delay
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:%PORT%"

:: Start server
cd /d "%~dp0"
set PORT=%PORT%
node server.js

pause
