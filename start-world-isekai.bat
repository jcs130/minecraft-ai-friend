@echo off

rem Start the WORLD process against the DOCKER ISEKAI server (mc-isekai, 2026-08-25).
rem ???25599?? start-world.bat ?????????
rem ?????MC 25699 / RCON 25580 / viewer 3051(+100=3151)?
rem ??????ops\docker\goddess-data???? data ?????????/?????????

cd /d %~dp0

set "MC_GOD_NAME=Goddess"
set "MC_HOST=localhost"
set "MC_PORT=25699"
set "MC_RCON_PORT=25580"
set "MC_VIEWER=1"
set "MC_VIEWER_PORT=3051"
set "MC_DATA_DIR=%~dp0ops\docker\goddess-data"
set "MC_LOG_PATH=%~dp0ops\docker\data\logs\latest.log"
set "MC_ADVANCEMENTS_DIR=%~dp0ops\docker\data\world\advancements"

rem ??? VIP ???????????
set "MC_VIP_LISTEN=mengmeng,kangqiang"

set "TSX=%~dp0node_modules\.bin\tsx.cmd"

if not exist "%MC_DATA_DIR%" mkdir "%MC_DATA_DIR%"

echo ===== world-isekai boot %date% %time% ===== >> "%MC_DATA_DIR%\world-process.log"

"%TSX%" bootstrap-world.mts >> "%MC_DATA_DIR%\world-process.log" 2>> "%MC_DATA_DIR%\world-process.err.log"
