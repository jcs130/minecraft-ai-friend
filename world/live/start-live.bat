@echo off
REM QiandengJi live console + host open API - host process (binds 0.0.0.0, LAN readable)
REM Uses host-published ports for panel/tts/qwenpaw; writes survivor control.json directly.
cd /d D:\Projects\QiandengJi\world\live
set LIVE_HOST=0.0.0.0
set LIVE_PORT=19095
set PANEL_URL=http://127.0.0.1:19091
set TTS_URL=http://127.0.0.1:8100
set QWENPAW_URL=http://127.0.0.1:18089
set SURVIVOR_STATE_DIR=D:\Projects\QiandengJi\server\survival-agent-state\survival
REM Write-API token (external machines must send header x-live-token to command/ask/say)
set LIVE_WRITE_TOKEN=292c6b067cee1275e398f88fea41f88604ebd8ded7bed38d
REM Bilibili live room id (empty = danmaku off until set)
set BILI_ROOM=
REM kill zombie instance holding the port (2026-09-27: /end leaves detached node behind, new run dies EADDRINUSE)
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %LIVE_PORT% -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
"C:\Program Files\nodejs\node.exe" server.mjs >> live.log 2>&1
