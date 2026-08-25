@echo off

rem Start the WORLD process (goddess avatar, sole RCON holder) - REPO-side runner (2026-08-20).

rem Runtime state lives in B-repo mc-data via MC_DATA_DIR (A-repo deepseek-harness purged 2026-08-26).

rem Logs append to %MC_DATA_DIR%\world-process.log / .err.log

cd /d %~dp0

for %%I in ("%~dp0..") do set "WS=%%~fI"


set "MC_GOD_NAME=Goddess"

set "MC_PORT=25599"

set "MC_VIEWER=1"

set "MC_VIEWER_PORT=3050"

set "MC_DATA_DIR=%~dp0mc-data"

set "MC_LOG_PATH=%~dp0mc-server\logs\latest.log"

set "MC_ADVANCEMENTS_DIR=%~dp0mc-server\world\advancements"

rem 受守护 VIP 真人白名单（逗号分隔）：说的一切女神都聆听回应，绕过冷启动/静默/节流三闸
set "MC_VIP_LISTEN=mengmeng,kangqiang"

set "TSX=%~dp0node_modules\.bin\tsx.CMD"

if not exist "%MC_DATA_DIR%" mkdir "%MC_DATA_DIR%"

echo ===== world boot %date% %time% ===== >> "%MC_DATA_DIR%\world-process.log"

"%TSX%" bootstrap-world.mts >> "%MC_DATA_DIR%\world-process.log" 2>> "%MC_DATA_DIR%\world-process.err.log"

