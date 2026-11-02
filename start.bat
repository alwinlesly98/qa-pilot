@echo off
REM QA Pilot launcher for Windows.
REM   start.bat        install if needed, build the UI and start on http://localhost:4300
REM   start.bat dev    development mode with hot reload (UI on http://localhost:5173)
setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM ---- 1. Find Node 22+ : the one on PATH first, otherwise the newest nvm install (global Node is not changed)
set "NODE_OK="
set "MAJOR="
for /f "tokens=1 delims=." %%m in ('node -v 2^>nul') do set "MAJOR=%%m"
if defined MAJOR (
  set "MAJOR=!MAJOR:v=!"
  if !MAJOR! GEQ 22 set "NODE_OK=1"
)
if not defined NODE_OK (
  for /f "delims=" %%d in ('dir /b /ad /o-n "%APPDATA%\nvm\v*" 2^>nul') do (
    if not defined NODE_OK if exist "%APPDATA%\nvm\%%d\node.exe" (
      for /f "tokens=1 delims=." %%m in ("%%d") do set "MAJOR=%%m"
      set "MAJOR=!MAJOR:v=!"
      if !MAJOR! GEQ 22 (
        set "PATH=%APPDATA%\nvm\%%d;!PATH!"
        set "NODE_OK=1"
      )
    )
  )
)
if not defined NODE_OK (
  echo.
  echo  QA Pilot needs Node.js 22 or newer.
  echo  Install the LTS version from https://nodejs.org  ^(or: nvm install lts^), then run start.bat again.
  echo.
  pause
  exit /b 1
)
for /f %%v in ('node -v') do echo Using Node %%v

REM ---- 2. First-time setup
if not exist .env copy .env.example .env >nul
if not exist node_modules (
  echo Installing dependencies ^(first run, takes a few minutes^)...
  call npm install || goto :fail
)
REM Downloads Chromium only if it is missing; quick otherwise.
call npx playwright install chromium || goto :fail

REM ---- 3. Start
if /i "%1"=="dev" (
  call npm run dev
) else (
  start "" cmd /c "timeout /t 8 /nobreak >nul & start http://localhost:4300"
  call npm start
)
exit /b 0

:fail
echo.
echo  Setup failed - see the messages above. Check your internet connection and free disk space, then run start.bat again.
pause
exit /b 1
