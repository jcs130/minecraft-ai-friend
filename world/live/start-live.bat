@echo off
setlocal
REM Local settings belong in the caller's private environment, never in Git.
cd /d "%~dp0"
if not defined LIVE_HOST set "LIVE_HOST=127.0.0.1"
if not defined LIVE_PORT set "LIVE_PORT=19095"
if not defined PANEL_URL set "PANEL_URL=http://127.0.0.1:19091"
if not defined TTS_URL set "TTS_URL=http://127.0.0.1:8100"
if not defined QWENPAW_URL set "QWENPAW_URL=http://127.0.0.1:18089"
if not defined SURVIVOR_STATE_DIR set "SURVIVOR_STATE_DIR=%~dp0..\..\server\survival-agent-state\survival"
if not defined LIVE_WRITE_TOKEN (
  echo Set LIVE_WRITE_TOKEN in your private environment before starting.
  exit /b 1
)
REM An occupied port must be checked by its owner; never kill an unrelated process.
node server.mjs >> live.log 2>&1
exit /b %ERRORLEVEL%
