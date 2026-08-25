@echo off
setlocal
cd /d "%~dp0mods"
set "TARGET=Cobblemon-neoforge-1.7.3+1.21.1.jar"
set "URL=https://cdn.modrinth.com/data/MdwFAVRL/versions/S1TrAn8c/Cobblemon-neoforge-1.7.3+1.21.1.jar"
set /a tries=0
:loop
set /a tries+=1
echo === try %tries% ===
curl -L --connect-timeout 30 --speed-limit 1024 --speed-time 30 -C - -o "%TARGET%" "%URL%"
if %errorlevel%==0 (
  echo DOWNLOAD_COMPLETE
  goto :verify
)
if %tries% geq 40 (
  echo GAVE_UP_AFTER_40_TRIES
  exit /b 1
)
timeout /t 5 /nobreak >nul
goto :loop
:verify
for %%F in ("%TARGET%") do echo SIZE=%%~zF
exit /b 0
