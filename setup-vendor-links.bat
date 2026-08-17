@echo off
rem Restore @deepseek-ai junctions into node_modules (npm install may wipe them).
rem These packages live in the dsh monorepo (vendor/ and packages/core/), not on npm.
rem NOTE: mklink /J resolves RELATIVE targets against the CURRENT DIRECTORY.
rem       Always pass ABSOLUTE targets (derived from %~dp0).
rem NOTE: this repo sits at workspace root, the dsh monorepo is at ..\deepseek-harness
rem       (one level deeper than repo A scratch-plugin, so HARNESS_ROOT needs the extra hop).
rem NOTE2: broken junctions fail `if exist` checks, so we rmdir-if-missing then always re-mklink.
cd /d %~dp0
set "HARNESS_ROOT=%~dp0..\deepseek-harness"
for %%I in ("%HARNESS_ROOT%") do set "HARNESS_ROOT=%%~fI"
if not exist node_modules\@deepseek-ai mkdir node_modules\@deepseek-ai
if not exist node_modules\@deepseek-ai\cordis rmdir node_modules\@deepseek-ai\cordis
if not exist node_modules\@deepseek-ai\schemastery rmdir node_modules\@deepseek-ai\schemastery
if not exist node_modules\@deepseek-ai\cordis-plugin-timer rmdir node_modules\@deepseek-ai\cordis-plugin-timer
if not exist node_modules\@deepseek-ai\dsh-system-prompt rmdir node_modules\@deepseek-ai\dsh-system-prompt
if not exist node_modules\@deepseek-ai\dsh-tools rmdir node_modules\@deepseek-ai\dsh-tools
mklink /J node_modules\@deepseek-ai\cordis "%HARNESS_ROOT%\vendor\cordis"
mklink /J node_modules\@deepseek-ai\schemastery "%HARNESS_ROOT%\vendor\schemastery"
mklink /J node_modules\@deepseek-ai\cordis-plugin-timer "%HARNESS_ROOT%\vendor\timer"
mklink /J node_modules\@deepseek-ai\dsh-system-prompt "%HARNESS_ROOT%\packages\core\system-prompt"
mklink /J node_modules\@deepseek-ai\dsh-tools "%HARNESS_ROOT%\packages\core\tools"
echo vendor links ready
