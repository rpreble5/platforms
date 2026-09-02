@echo off
REM Double-click this on Windows to start the game.
REM
REM The first time you run it, Windows Defender will ask whether to allow
REM Node through the firewall. Tick BOTH "Private" and "Public" and click
REM Allow -- office WiFi counts as Public, and without that box ticked no
REM phone can reach you.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node isn't installed.
  echo   Get the LTS version from https://nodejs.org, then run this again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo.
  echo   First run - installing dependencies ^(10-30 seconds^)...
  echo.
  call npm install
  if errorlevel 1 (
    echo   Install failed.
    pause
    exit /b 1
  )
)

REM Decks published from the Studio land in the repository; pick them up.
REM Offline (the venue) this just prints a line and carries on.
if exist .git (
  where git >nul 2>nul
  if not errorlevel 1 (
    echo.
    echo   Fetching any decks published since last time...
    git pull --ff-only --quiet 2>nul || echo   ^(couldn't pull - offline, or local changes; playing with the decks already here^)
  )
)

echo.
echo   Starting. Leave this window open; Ctrl+C stops the game.
echo.
call npm run dev

REM Keep the window up if the server exits, so any error is readable.
echo.
echo   Server stopped.
pause
