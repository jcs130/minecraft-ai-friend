@echo off
rem god-voice build: javac direct (same pattern as settlementsfix-src)
rem Requires: JDK on PATH (javac), run from god-voice-src directory

setlocal
cd /d "%~dp0"

set JAVAC_ARGS=-encoding UTF-8 -proc:none -nowarn --release 21
set MC="C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\mc-server\libraries\net\minecraft\server\1.21.1-20240808.144430\server-1.21.1-20240808.144430-srg.jar;C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\mc-server\libraries\net\minecraft\server\1.21.1-20240808.144430\server-1.21.1-20240808.144430-slim.jar"
set NF="C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\mc-server\libraries\net\neoforged\neoforge\21.1.73\neoforge-21.1.73-universal.jar;C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\mc-server\libraries\net\neoforged\fancymodloader\loader\4.0.31\loader-4.0.31.jar"
set LIBS="C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\mc-server\libraries\com\google\code\gson\gson\2.10.1\gson-2.10.1.jar;C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\mc-server\libraries\com\mojang\logging\1.2.7\logging-1.2.7.jar;C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\mc-server\libraries\org\slf4j\slf4j-api\2.0.9\slf4j-api-2.0.9.jar;C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\mc-server\libraries\org\apache\logging\log4j\log4j-api\2.22.1\log4j-api-2.22.1.jar;C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\mc-server\libraries\com\mojang\brigadier\1.3.10\brigadier-1.3.10.jar;C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\mc-server\libraries\com\mojang\authlib\6.0.54\authlib-6.0.54.jar"
set SVC="C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\mc\mods\voicechat-neoforge-1.21.1-2.6.22.jar"
set CP=%MC%;%NF%;%LIBS%;%SVC%

if not exist classes mkdir classes

echo [1/3] compiling...
javac %JAVAC_ARGS% -cp %CP% -d classes dev\god\godvoice\GodVoiceMod.java dev\god\godvoice\GodVoicePlugin.java dev\god\godvoice\GodVoiceLog.java dev\god\godvoice\TtsQueueWatcher.java dev\god\godvoice\MicCapture.java
if errorlevel 1 goto :fail

echo [2/3] packaging...
if exist dist\god-voice-0.1.0.jar del dist\god-voice-0.1.0.jar
jar cf dist\god-voice-0.1.0.jar -C classes . -C . META-INF
if errorlevel 1 goto :fail

echo [3/3] done: dist\god-voice-0.1.0.jar
exit /b 0

:fail
echo BUILD FAILED
exit /b 1
