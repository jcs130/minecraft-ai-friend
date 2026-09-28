@echo off
rem naruto-lite keepalive supervisor - ASCII only, CRLF
rem node exit/crash auto-restart every 10s; schtasks onlogon launches this
setlocal
set NARUTO_PORT=25702
set NARUTO_NAME=ag_naruto
cd /d D:\Projects\QiandengJi\world\naruto-lite
:loop
>> D:\Projects\QiandengJi\runtime\naruto-lite.out.log 2>&1 node naruto_lite.cjs
>> D:\Projects\QiandengJi\runtime\naruto-lite.out.log echo [supervisor] node exited %date% %time% - restart in 10s
ping -n 11 127.0.0.1 >nul
goto loop
