# -*- coding: utf-8 -*-
# settlementsfix 编译+打包脚本（固化 2026-08-22 右键对话链路）
# 用法: powershell -ExecutionPolicy Bypass -File ops/build_settlementsfix.ps1
# 产物: build-settlementsfix\dist\settlementsfix.jar（含 SettlementsFixMod 右键监听 + 4 mixin）
$ErrorActionPreference = 'Stop'

$ROOT = 'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend'
$BUILD = Join-Path $ROOT 'build-settlementsfix'
$SERVER = 'C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\scratch-plugin\mc-server-neoforge'
$JDK = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot'
$JAVAC = Join-Path $JDK 'bin\javac.exe'
$JAR = Join-Path $JDK 'bin\jar.exe'

$SRC = Join-Path $BUILD 'src'
$CLASSES = Join-Path $BUILD 'classes'
$DIST = Join-Path $BUILD 'dist'
$OUT_JAR = Join-Path $DIST 'settlementsfix.jar'

# 清理旧 classes（避免残留旧 class）
if (Test-Path $CLASSES) { Remove-Item $CLASSES -Recurse -Force }
New-Item -ItemType Directory -Force -Path $CLASSES | Out-Null
New-Item -ItemType Directory -Force -Path $DIST | Out-Null

# classpath: settlements mod jar + libraries 全量
$cpItems = @()
$cpItems += (Join-Path $SERVER 'mods\settlements-1.0.0-beta.1.jar')
$cpItems += (Get-ChildItem (Join-Path $SERVER 'libraries') -Recurse -Filter *.jar | ForEach-Object { $_.FullName })
$cpStr = ($cpItems -join ';')

# 收集源文件
Write-Host "SRC=$SRC exists=$(Test-Path (Join-Path $SRC 'dev'))"
$sources = @(Get-ChildItem (Join-Path $SRC 'dev') -Recurse -Filter *.java | ForEach-Object { $_.FullName })
Write-Host "sources found: $($sources.Count)"
if ($sources.Count -eq 0) { throw 'no java sources found' }

Write-Host "compiling $($sources.Count) sources with JDK21..."
& $JAVAC -proc:none -encoding UTF-8 -cp $cpStr -d $CLASSES $sources
if ($LASTEXITCODE -ne 0) { throw "javac failed: $LASTEXITCODE" }
Write-Host 'compile OK'

# 打包: classes + META-INF + mixins.json
& $JAR cf $OUT_JAR -C $CLASSES . -C $SRC 'META-INF' -C $SRC 'settlementsfix.mixins.json'
if ($LASTEXITCODE -ne 0) { throw "jar failed: $LASTEXITCODE" }
Write-Host "jar OK: $OUT_JAR ($((Get-Item $OUT_JAR).Length) bytes)"
Write-Host 'contents:'
& $JAR tf $OUT_JAR | Select-String 'dev/god' | ForEach-Object { '  ' + $_.Line }
