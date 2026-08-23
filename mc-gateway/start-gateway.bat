@echo off
REM ============================================================
REM  mc-gateway 常驻启动器（女神 mc-god 自持）
REM  用法：start-gateway.bat
REM  1) 保证干净解释器（清 uv 劫持的 PYTHONHOME/PYTHONPATH）
REM  2) 端口 8011 防重复启动
REM  3) 后台运行 + 日志重定向 gateway.log
REM ============================================================
setlocal
set "PYTHONHOME="
set "PYTHONPATH="
set "PY="C:\Users\lzl19\AppData\Local\Programs\Python\Python311\python.exe"

set "HERE=%~dp0"
set "LOGFILE=%HERE%gateway.log"

REM --- 端口占用检测（已跑则退出）---
powershell -Command "(Get-NetTCPConnection -LocalPort 8011 -ErrorAction SilentlyContinue).Count" > "%TEMP%\_gwport.txt"
set /p HASPORT=<"%TEMP%\_gwport.txt"
del "%TEMP%\_gwport.txt" >nul 2>&1
if "%HASPORT%"=="1" (
  echo [mc-gateway] already listening on 8011
  exit /b 0
)
if not "%HASPORT%"=="0" (
  echo [mc-gateway] port check unavailable, assume starting
)

REM --- 后台启动（独立进程，日志重定向）---
echo [mc-gateway] starting on 0.0.0.0:8011 ...
start "" /b "%PY%" "%HERE%mc_gateway.py" >> "%LOGFILE%" 2>&1
echo [mc-gateway] launched. log: %LOGFILE%
endlocal
