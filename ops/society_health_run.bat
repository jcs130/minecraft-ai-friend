@echo off
REM 小社会巡检（点5）：mc_npc / guard_drive / 女神世界进程 / skin-proxy 健康检查
REM 只读体检 + 报告；异常由创世天神审阅后处理。用干净 Python（清 uv 劫持的 PYTHONHOME）。
set PYTHONHOME=
set PYTHONPATH=
C:\Python314\python.exe "C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\society_health.py" >> "C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\scratch-plugin\data\society-health-run.log" 2>&1
