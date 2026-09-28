@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\MC\ops\start-server.ps1"
exit /b %errorlevel%
