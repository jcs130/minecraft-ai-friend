@echo off
rem Observation panel (:9090) - serves web-panel.mjs (multi-transmigrator UI).
cd /d %~dp0
if not exist data mkdir data
echo ===== panel boot %date% %time% ===== >> data\panel-process.log
node web-panel.mjs >> data\panel-process.log 2>> data\panel-process.err.log
