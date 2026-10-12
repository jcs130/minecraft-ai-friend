$ErrorActionPreference = 'Stop'
$protectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$protectJdk = 'E:/MC/jdk/jdk-21.0.12.1+1/bin'
$protectGson = Get-ChildItem -LiteralPath 'E:/MC/server/libraries/com/google/code/gson/gson' -Recurse -Filter '*.jar' -File | Select-Object -First 1 -ExpandProperty FullName
if (-not $protectGson) { throw 'Paper Gson library missing' }
$protectBuild = Join-Path $protectRoot 'build-test-machine-chat'
New-Item -ItemType Directory -Path $protectBuild -Force | Out-Null
& "$protectJdk/javac.exe" -proc:none -encoding UTF8 -cp $protectGson -d $protectBuild "$protectRoot/src/org/afuhome/cortieye/MachineChatReceipts.java" "$protectRoot/test/org/afuhome/cortieye/MachineChatReceiptsTest.java"
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }
& "$protectJdk/java.exe" -ea -cp "$protectBuild;$protectGson" org.afuhome.cortieye.MachineChatReceiptsTest
if ($LASTEXITCODE -ne 0) { throw 'Machine chat regression failed' }
