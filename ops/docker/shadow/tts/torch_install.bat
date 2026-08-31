@echo off
rem torch cu128 install from aliyun pytorch-wheels mirror (2026-09-01)
set "PYTHONHOME="
set "PYTHONPATH="
cd /d C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\tts
hostenv\Scripts\pip.exe install "https://mirrors.aliyun.com/pytorch-wheels/cu128/torch-2.8.0%%2Bcu128-cp311-cp311-win_amd64.whl" "https://mirrors.aliyun.com/pytorch-wheels/cu128/torchaudio-2.8.0%%2Bcu128-cp311-cp311-win_amd64.whl" > torch_install.log 2>&1
