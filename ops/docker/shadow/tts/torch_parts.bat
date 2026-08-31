@echo off
rem torch cu128 4-part parallel download from SJTU mirror (-L for redirect)
rem total 3461420395 bytes; measured 3.4MB/s single stream
cd /d C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\tts
set U=https://mirror.sjtu.edu.cn/pytorch-wheels/cu128/torch-2.8.0%%2Bcu128-cp311-cp311-win_amd64.whl
start /b curl.exe -s -L --retry 8 --retry-all-errors --retry-delay 2 -r 0-865355098          -o torch_p0.bin "%U%"
start /b curl.exe -s -L --retry 8 --retry-all-errors --retry-delay 2 -r 865355099-1730710197  -o torch_p1.bin "%U%"
start /b curl.exe -s -L --retry 8 --retry-all-errors --retry-delay 2 -r 1730710198-2596065296 -o torch_p2.bin "%U%"
start /b curl.exe -s -L --retry 8 --retry-all-errors --retry-delay 2 -r 2596065297-3461420394 -o torch_p3.bin "%U%"
