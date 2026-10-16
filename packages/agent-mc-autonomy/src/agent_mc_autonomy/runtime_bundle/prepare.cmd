@echo off
setlocal
"%~dp0node\node.exe" "%~dp0prepare.mjs" %*
if errorlevel 1 exit /b 1
echo Runtime prepared. Import the included plugin, configure your account and model, then explicitly start.
