@echo off
rem Observation panel (:9090) - serves web-panel.mjs - REPO-side runner (2026-08-20).
rem Reads runtime state (bot streams/episodic/shots) from scratch-plugin\data via MC_DATA_DIR.
cd /d %~dp0
for %%I in ("%~dp0..") do set "WS=%%~fI"
set "SCRATCH=%WS%\deepseek-harness\scratch-plugin"
set "MC_DATA_DIR=%SCRATCH%\data"
set "MC_SERVER_DIR=%SCRATCH%\mc-server-neoforge"
if not exist "%MC_DATA_DIR%" mkdir "%MC_DATA_DIR%"
echo ===== panel boot %date% %time% ===== >> "%MC_DATA_DIR%\panel-process.log"
node web-panel.mjs >> "%MC_DATA_DIR%\panel-process.log" 2>> "%MC_DATA_DIR%\panel-process.err.log"
