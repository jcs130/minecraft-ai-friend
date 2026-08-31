@echo off
rem god-tts host-resident: IndexTTS 2.5 shenyuge TTS on host (2026-09-01)
rem detached from docker engine lifecycle; started by schtask god-tts-host ONLOGON
set PYTHONHOME=
set PYTHONPATH=
set TTS_CKPT=C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\tts\checkpoints
set TTS_VOICES=C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\tts\voices
set TTS_DEFAULT_VOICE=goddess
set TTS_HOST=127.0.0.1
set TTS_PORT=8100
set HF_ENDPOINT=https://hf-mirror.com
cd /d C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\tts
hostenv\Scripts\python.exe -u ..\gpu-tts\tts_api.py >> host_tts.log 2>&1
