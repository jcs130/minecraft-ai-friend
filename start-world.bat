@echo off
rem Start the WORLD process (goddess avatar, sole RCON holder).
rem Must run on the machine hosting the MC server.
rem Logs append to data\world-process.log / data\world-process.err.log
cd /d %~dp0
set "MC_GOD_NAME=Goddess"
set "TSX=C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\node_modules\.bin\tsx.CMD"
echo ===== world boot %date% %time% ===== >> data\world-process.log
"%TSX%" bootstrap-world.mts >> data\world-process.log 2>> data\world-process.err.log
