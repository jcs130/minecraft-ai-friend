@echo off
cd /d "%~dp0"
call run-python.bat tools\operations.py %*
