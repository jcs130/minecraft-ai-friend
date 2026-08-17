@echo off
rem Restore @deepseek-ai junctions into node_modules (npm install may wipe them).
rem These packages live in the dsh monorepo (vendor/ + packages/core/), not on npm.
rem NOTE: mklink /J resolves RELATIVE targets against the CURRENT DIRECTORY, not
rem       the link location. Always pass ABSOLUTE targets (derived from %~dp0).
cd /d %~dp0
set "HARNESS_ROOT=%~dp0.."
for %%I in ("%HARNESS_ROOT%") do set "HARNESS_ROOT=%%~fI"
rem NOTE2: any npm install ALSO wipes node_modules/{node-canvas-webgl,canvas,gl}.
rem        node-canvas-webgl: `npm i --no-save --legacy-peer-deps --ignore-scripts node-canvas-webgl`
rem        canvas/gl native builds: robocopy from C:\Users\lzl19\Documents\mindcraft\node_modules\{canvas,gl}
if not exist node_modules\@deepseek-ai mkdir node_modules\@deepseek-ai
if not exist node_modules\@deepseek-ai\cordis mklink /J node_modules\@deepseek-ai\cordis "%HARNESS_ROOT%\vendor\cordis"
if not exist node_modules\@deepseek-ai\schemastery mklink /J node_modules\@deepseek-ai\schemastery "%HARNESS_ROOT%\vendor\schemastery"
if not exist node_modules\@deepseek-ai\cordis-plugin-timer mklink /J node_modules\@deepseek-ai\cordis-plugin-timer "%HARNESS_ROOT%\vendor\timer"
if not exist node_modules\@deepseek-ai\dsh-system-prompt mklink /J node_modules\@deepseek-ai\dsh-system-prompt "%HARNESS_ROOT%\packages\core\system-prompt"
if not exist node_modules\@deepseek-ai\dsh-tools mklink /J node_modules\@deepseek-ai\dsh-tools "%HARNESS_ROOT%\packages\core\tools"
echo vendor links ready
