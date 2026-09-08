@echo off
cd /d "%~dp0"
call run-python.bat tools\launch_client.py --interactive --server 127.0.0.1:25567
pause
