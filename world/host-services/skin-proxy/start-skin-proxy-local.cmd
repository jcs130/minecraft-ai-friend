@echo off
REM 本机皮肤代理（只服务我们的 bot，不动真人连线）：
REM   bot -> proxy :25566 -> java :25565
REM 皮肤库直接用 A 侧 profile 的 skins.json（与面板/agent-store 同一份，单一事实源）
set SKIN_LISTEN_PORT=25566
set SKIN_UPSTREAM_HOST=127.0.0.1
set SKIN_UPSTREAM_PORT=25701
set MC_VERSION=1.21.1
set SKINS_FILE=C:\Users\lzl19\.dsh\profiles\web\data\skins.json
cd /d C:\Users\lzl19\.dsh\profiles\web
node skin-proxy-local.mjs >> skin-proxy-local.log 2>&1
