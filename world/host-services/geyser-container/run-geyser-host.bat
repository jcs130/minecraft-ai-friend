@echo off
cd /d "D:\Projects\QiandengJi\server\geyser-standalone"
set JAVA=C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin\java.exe
:loop
echo [geyser] start %DATE% %TIME% >> geyser-watch.log
"%JAVA%" -Xmx1G -jar Geyser-Standalone.jar >> geyser.log 2>&1
echo [geyser] exit %DATE% %TIME% rc=%ERRORLEVEL% >> geyser-watch.log
timeout /t 15 /nobreak >nul
goto loop
