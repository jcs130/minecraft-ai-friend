@echo off
rem Start the SKIN PROXY (25565 -> java 25599) - REPO-side runner (2026-08-22).
rem Logs append to sidecar\skin-proxy.log / .err.log
chcp 65001 >nul
cd /d %~dp0
set "SKINS_FILE=%~dp0data\skins.json"
node sidecar\skin-proxy.mjs >> sidecar\skin-proxy.log 2>> sidecar\skin-proxy.err.log
