@echo off
rem naruto-lite keepalive launcher (A/B experiment body; ASCII only)
set NARUTO_PORT=25702
set NARUTO_NAME=ag_naruto
cd /d D:\Projects\QiandengJi\world\naruto-lite
>> D:\Projects\QiandengJi\runtime\naruto-lite.out.log 2>&1 node naruto_lite.cjs
