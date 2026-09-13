@echo off
cd /d "%~dp0"
call run-python.bat tools\project.py stop
pause
