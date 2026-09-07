@echo off
cd /d "%~dp0"
call run-python.bat world\ops\health\health_mon.py
pause
