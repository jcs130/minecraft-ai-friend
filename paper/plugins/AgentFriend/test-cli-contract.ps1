param([string]$PluginClasses=(Join-Path $PSScriptRoot 'build-0.4.44-mc-1.21.1'))
$ErrorActionPreference='Stop'
$cliRoot=$PSScriptRoot
$cliJava='E:/MC/jdk/jdk-21.0.12.1+1/bin'
$cliBuild=Join-Path $cliRoot 'build-cli-contract-tests'
New-Item -ItemType Directory -Path $cliBuild -Force | Out-Null
$cliLibraries=(Get-ChildItem -LiteralPath 'E:/MC/server/libraries' -Recurse -File -Filter '*.jar' | ForEach-Object {$_.FullName}) -join ';'
if(-not (Test-Path -LiteralPath (Join-Path $PluginClasses 'org/afuhome/agentfriend/AgentCliCatalog.class'))){throw 'Build the current plugin first, or pass -PluginClasses for the tested candidate.'}
$cliClasspath=$PluginClasses+';'+$cliLibraries
$cliArgs=Join-Path $cliBuild 'compile.args'
$cliRun=Join-Path $cliBuild 'run.args'
$cliUtf8=[Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllLines($cliArgs,(@('-proc:none','-encoding','UTF-8','-cp',$cliClasspath,'-d',$cliBuild,(Join-Path $cliRoot 'tests/org/afuhome/agentfriend/AgentCliContractTest.java')) | ForEach-Object {'"'+$_.Replace('\','/')+'"'}),$cliUtf8)
[IO.File]::WriteAllLines($cliRun,(@('-cp',($cliBuild+';'+$cliClasspath),'org.afuhome.agentfriend.AgentCliContractTest') | ForEach-Object {'"'+$_.Replace('\','/')+'"'}),$cliUtf8)
& (Join-Path $cliJava 'javac.exe') "@$cliArgs"
if($LASTEXITCODE -ne 0){throw 'CLI contract test compilation failed'}
& (Join-Path $cliJava 'java.exe') "@$cliRun"
if($LASTEXITCODE -ne 0){throw 'CLI contract checks failed'}
