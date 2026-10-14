$ErrorActionPreference='Stop'
$cliRoot=$PSScriptRoot
$cliJava='E:/MC/jdk/jdk-21.0.12.1+1/bin'
$cliBuild=Join-Path $cliRoot 'build-0.4.40-tests'
New-Item -ItemType Directory -Path $cliBuild -Force | Out-Null
$cliLibraries=(Get-ChildItem -LiteralPath 'E:/MC/server/libraries' -Recurse -File -Filter '*.jar' | ForEach-Object {$_.FullName}) -join ';'
$cliClasspath=(Join-Path $cliRoot 'build-0.4.40')+';'+$cliLibraries
& (Join-Path $cliJava 'javac.exe') -proc:none -encoding UTF-8 -cp $cliClasspath -d $cliBuild (Join-Path $cliRoot 'tests/org/afuhome/agentfriend/AgentCliContractTest.java')
if($LASTEXITCODE -ne 0){throw 'CLI contract test compilation failed'}
& (Join-Path $cliJava 'java.exe') -cp ($cliBuild+';'+$cliClasspath) org.afuhome.agentfriend.AgentCliContractTest
if($LASTEXITCODE -ne 0){throw 'CLI contract checks failed'}
