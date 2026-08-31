@echo off
rem god-voice-watcher host-resident: goddess text-queue -> shenyuge(127.0.0.1:8100) mp3 -> tts-queue (2026-09-01)
rem edge-tts fallback kept; started by schtask god-voice-host ONLOGON
set PYTHONHOME=
set PYTHONPATH=
set GV_BASE=C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\mc\data\godvoice
set TTS_LOCAL_URL=http://127.0.0.1:8100
cd /d C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\tts
hostenv\Scripts\python.exe -u ..\..\..\sidecar\god-voice-watcher.py >> host_voice.log 2>&1
