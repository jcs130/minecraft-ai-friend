@echo off
rem Bedrock entry: ViaProxy+Geyser console mode (GUI mode hides and waits for a click that never comes)
rem Docker Desktop on Windows cannot publish UDP ports to the host, so this runs as a host process.
cd /d "%~dp0"
:loop

echo [vp] start %DATE% %TIME% >> vp-watch.log

"C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin\java.exe" -jar ViaProxy-3.4.12.jar cli --target-address 127.0.0.1:25701 --target-version 1.21.1 --auth-method NONE --bind-address 0.0.0.0:25568 > viaproxy-host.log 2> viaproxy-host.err.log

echo [vp] exit %DATE% %TIME% rc=%ERRORLEVEL% >> vp-watch.log

timeout /t 15 /nobreak >nul

goto loop

