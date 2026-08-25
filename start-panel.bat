@echo off

rem Observation panel (:9090) - serves web-panel.mjs - B-repo self-contained runner (2026-08-26).

rem Reads runtime state (bot streams/episodic/shots) from B-repo mc-data via MC_DATA_DIR.

cd /d %~dp0

set "MC_DATA_DIR=%~dp0mc-data"

set "MC_SERVER_DIR=%~dp0mc-server"

if not exist "%MC_DATA_DIR%" mkdir "%MC_DATA_DIR%"

echo ===== panel boot %date% %time% ===== >> "%MC_DATA_DIR%\panel-process.log"

node web-panel.mjs >> "%MC_DATA_DIR%\panel-process.log" 2>> "%MC_DATA_DIR%\panel-process.err.log"
