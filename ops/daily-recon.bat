@echo off
rem 创世天神每日外勤侦察 —— 触发 mc-god 做 Agent/MC 外勤侦察（点3，2026-08-23）
rem 清 PYTHONHOME/PYTHONPATH：本机 Python 被 uv 劫持，干净解释器需先清再跑
set PYTHONHOME=
set PYTHONPATH=
"C:\Python314\python.exe" "C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\daily-recon.py"
