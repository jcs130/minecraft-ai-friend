@echo off
rem Start the WORLD process (goddess avatar, sole RCON holder) - REPO-side runner (2026-08-20).
rem Runtime state lives in the field deployment dir (scratch-plugin) via MC_DATA_DIR.
rem Logs append to %MC_DATA_DIR%\world-process.log / .err.log
cd /d %~dp0
for %%I in ("%~dp0..") do set "WS=%%~fI"
set "SCRATCH=%WS%\deepseek-harness\scratch-plugin"
set "MC_GOD_NAME=Goddess"
set "MC_VIEWER=1"
set "MC_VIEWER_PORT=3050"
set "MC_DATA_DIR=%SCRATCH%\data"
set "MC_LOG_PATH=%SCRATCH%\mc-server-neoforge\logs\latest.log"
set "MC_ADVANCEMENTS_DIR=%SCRATCH%\mc-server-neoforge\world\advancements"
set "TSX=%WS%\deepseek-harness\node_modules\.bin\tsx.CMD"
if not exist "%MC_DATA_DIR%" mkdir "%MC_DATA_DIR%"
echo ===== world boot %date% %time% ===== >> "%MC_DATA_DIR%\world-process.log"
"%TSX%" bootstrap-world.mts >> "%MC_DATA_DIR%\world-process.log" 2>> "%MC_DATA_DIR%\world-process.err.log"
