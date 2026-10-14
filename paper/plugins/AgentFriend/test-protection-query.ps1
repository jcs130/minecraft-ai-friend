$ErrorActionPreference = 'Stop'
$protectionRoot = $PSScriptRoot
$protectionJava = 'E:/MC/jdk/jdk-21.0.12.1+1/bin'
$protectionBuild = Join-Path $protectionRoot 'build-0.4.40-tests'
New-Item -ItemType Directory -Path $protectionBuild -Force | Out-Null
$protectionLibraries = (Get-ChildItem -LiteralPath 'E:/MC/server/libraries' -Recurse -File -Filter '*.jar' | ForEach-Object {$_.FullName}) -join ';'
$protectionClasspath = (Join-Path $protectionRoot 'build-0.4.40') + ';' + $protectionLibraries
& (Join-Path $protectionJava 'javac.exe') -proc:none -encoding UTF-8 -cp $protectionClasspath -d $protectionBuild (Join-Path $protectionRoot 'tests/org/afuhome/agentfriend/ProtectionQueryTest.java')
if ($LASTEXITCODE -ne 0) { throw 'Protection query test compilation failed' }
& (Join-Path $protectionJava 'java.exe') -cp ($protectionBuild + ';' + $protectionClasspath) org.afuhome.agentfriend.ProtectionQueryTest
if ($LASTEXITCODE -ne 0) { throw 'Protection query checks failed' }
