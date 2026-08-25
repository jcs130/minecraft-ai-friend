@echo off
rem 灶火祭司（mc_oracle，settlements 推理适配器，:9001）启动器
rem 2026-08-24 新家版：数据目录 = B 仓 mc-data（NPC_DATA_DIR）
rem 用法: ops\start-oracle.bat   （日志: mc-data\mc-oracle.log / mc-oracle.err.log）
cd /d "C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\sidecar"
set "NPC_DATA_DIR=C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\mc-data"
set "MC_VIP_LISTEN=mengmeng,kangqiang"
set "MC_ORACLE_PORT=9001"
set "PYTHONHOME="
set "PYTHONPATH="
start "mc-oracle" /min cmd /c "C:\Users\lzl19\.qwenpaw\venv\Scripts\python.exe mc_oracle.py > C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\mc-data\mc-oracle.log 2> C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\mc-data\mc-oracle.err.log"
