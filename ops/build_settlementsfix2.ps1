# -*- coding: utf-8 -*-
# settlementsfix 重建脚本（2026-08-24 新家版）
# 布局: settlementsfix-src/dev/**(.class 基线 + 新增 .java 源码) + META-INF + settlementsfix.mixins.json
# 产物: settlementsfix-src/dist/settlementsfix.jar
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File ops/build_settlementsfix2.ps1
$ErrorActionPreference = 'Stop'

$ROOT = 'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend'
$SRC = Join-Path $ROOT 'settlementsfix-src'
$DEV = Join-Path $SRC 'dev'
$CLASSES = Join-Path $SRC 'classes'
$SERVER = Join-Path $ROOT 'mc-server'
$JDK = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot'
$JAVAC = Join-Path $JDK 'bin\javac.exe'
$JAR = Join-Path $JDK 'bin\jar.exe'
$OUT_JAR = Join-Path $SRC 'dist\settlementsfix.jar'

# 1) classes 基线: 把 dev 树整体拷进去（保留 dev 层级），剔除源码
if (Test-Path $CLASSES) { Remove-Item $CLASSES -Recurse -Force }
New-Item -ItemType Directory -Force -Path $CLASSES | Out-Null
Copy-Item $DEV (Join-Path $CLASSES 'dev') -Recurse
Get-ChildItem $CLASSES -Recurse -Filter *.java | Remove-Item -Force

# 2) classpath: settlements jar + libraries 全量
# 2026-08-30: settlements jar 改名容忍（mods 里现名 +godfix.3 等，取第一个 settlements-*.jar，
# 排除 .bak 备份）；同时排除 vanilla 混淆版 server-1.21.1.jar（无时间戳目录那个）——
# 它会抢在 mapped slim/extra 之前解析 MinecraftServer，方法名全是 SRG 导致 getPlayerList 报红。
$settleJar = Get-ChildItem (Join-Path $SERVER 'mods') -Filter 'settlements-*.jar' |
    Where-Object { $_.Name -notmatch '\.bak' } | Select-Object -First 1
if (-not $settleJar) { throw 'settlements jar not found in mods/' }
$cpItems = @($settleJar.FullName)
# MC 官方分发的 slim/srg/unpacked 是 SRG 壳或半成品，会遮蔽 neoforge-<v>-server.jar
# 里 official-mapped 的 MinecraftServer（getPlayerList/getCommands 在后者）——一律剔除。
$cpItems += (Get-ChildItem (Join-Path $SERVER 'libraries') -Recurse -Filter *.jar |
    Where-Object { $_.Name -notmatch '^(server|client)-.*-(slim|srg|unpacked|extra)\.jar$' } |
    Where-Object { $_.Name -ne 'server-1.21.1.jar' } |
    ForEach-Object { $_.FullName })
$cpStr = $cpItems -join ';'

# 3) 编译 dev 树下所有 .java 源码（含新增）→ 输出进 classes
$sources = @(Get-ChildItem $DEV -Recurse -Filter *.java | ForEach-Object { $_.FullName })
if ($sources.Count -gt 0) {
    Write-Host "compiling $($sources.Count) sources with JDK21..."
    & $JAVAC -proc:none -encoding UTF-8 -cp $cpStr -d $CLASSES @sources
    if ($LASTEXITCODE -ne 0) { throw "javac failed: $LASTEXITCODE" }
    Write-Host 'compile OK'
} else {
    Write-Host 'no .java sources; packaging existing classes only'
}

# 4) 打包
New-Item -ItemType Directory -Force -Path (Join-Path $SRC 'dist') | Out-Null
if (Test-Path $OUT_JAR) { Remove-Item $OUT_JAR -Force }
& $JAR cf $OUT_JAR -C $CLASSES '.' -C $SRC 'META-INF' -C $SRC 'settlementsfix.mixins.json'
if ($LASTEXITCODE -ne 0) { throw "jar failed: $LASTEXITCODE" }
Write-Host "jar OK: $OUT_JAR ($((Get-Item $OUT_JAR).Length) bytes)"
& $JAR tf $OUT_JAR | ForEach-Object { '  ' + $_ }
