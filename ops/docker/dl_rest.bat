@echo off
setlocal
cd /d "%~dp0"
if not exist mods mkdir mods
call :get "irons_spellbooks-1.21.1-3.16.3.jar" "https://cdn.modrinth.com/data/s4OWxYQQ/versions/slKLosTb/irons_spellbooks-1.21.1-3.16.3.jar"
call :get "Cobblemon-neoforge-1.7.3+1.21.1.jar" "https://cdn.modrinth.com/data/MdwFAVRL/versions/S1TrAn8c/Cobblemon-neoforge-1.7.3%%2B1.21.1.jar"
call :get "geckolib-neoforge-1.21.1-4.9.2.jar" "https://cdn.modrinth.com/data/8BmcQJ2H/versions/tPkJmim6/geckolib-neoforge-1.21.1-4.9.2.jar"
call :get "curios-neoforge-9.5.1+1.21.1.jar" "https://cdn.modrinth.com/data/vvuO3ImH/versions/yohfFbgD/curios-neoforge-9.5.1%%2B1.21.1.jar"
call :get "player-animation-lib-forge-2.0.4+1.21.1.jar" "https://cdn.modrinth.com/data/gedNE4y2/versions/HJZB6bmA/player-animation-lib-forge-2.0.4%%2B1.21.1.jar"
call :get "mcw-mcwwindows-2.4.2-mc1.21.1neoforge.jar" "https://cdn.modrinth.com/data/C7I0BCni/versions/rQUE4LCz/mcw-mcwwindows-2.4.2-mc1.21.1neoforge.jar"
call :get "mcw-doors-1.1.5-mc1.21.1neoforge.jar" "https://cdn.modrinth.com/data/kNxa8z3e/versions/u7BRX44F/mcw-doors-1.1.5-mc1.21.1neoforge.jar"
call :get "mcw-roofs-2.3.2-mc1.21.1neoforge.jar" "https://cdn.modrinth.com/data/B8jaH3P1/versions/jiXRXiSt/mcw-roofs-2.3.2-mc1.21.1neoforge.jar"
call :get "mcw-bridges-3.1.2-mc1.21.1neoforge.jar" "https://cdn.modrinth.com/data/GURcjz8O/versions/aQ7rY7ng/mcw-bridges-3.1.2-mc1.21.1neoforge.jar"
call :get "mcw-mcwfences-1.2.1-mc1.21.1neoforge.jar" "https://cdn.modrinth.com/data/GmwLse2I/versions/jVdb0r4W/mcw-mcwfences-1.2.1-mc1.21.1neoforge.jar"
call :get "mcw-furniture-3.4.1-mc1.21.1neoforge.jar" "https://cdn.modrinth.com/data/dtWC90iB/versions/Z5V3Ps7S/mcw-furniture-3.4.1-mc1.21.1neoforge.jar"
call :get "mcw-mcwstairs-1.0.2-mc1.21.1neoforge.jar" "https://cdn.modrinth.com/data/iP3wH1ha/versions/4t8L0dGP/mcw-mcwstairs-1.0.2-mc1.21.1neoforge.jar"
call :get "mcw-mcwpaths-1.1.1-mc1.21.1neoforge.jar" "https://cdn.modrinth.com/data/VRLhWB91/versions/tlymsxUG/mcw-mcwpaths-1.1.1-mc1.21.1neoforge.jar"
call :get "mcw-lights-1.1.5-mc1.21.1neoforge.jar" "https://cdn.modrinth.com/data/w4an97C2/versions/5U2kQZIL/mcw-lights-1.1.5-mc1.21.1neoforge.jar"
call :get "mcw-trapdoors-1.1.5-mc1.21.1neoforge.jar" "https://cdn.modrinth.com/data/n2fvCDlM/versions/StnP0RNi/mcw-trapdoors-1.1.5-mc1.21.1neoforge.jar"
call :get "mcw-paintings-1.1.0-mc1.21.1neoforge.jar" "https://cdn.modrinth.com/data/okE6QVAY/versions/W9QHKmDh/mcw-paintings-1.1.0-mc1.21.1neoforge.jar"
echo ALL_DONE
goto :eof

:get
echo === %~1 ===
curl -L --retry 5 --retry-delay 2 --connect-timeout 30 -C - -o "mods\%~1" "%~2"
exit /b 0
