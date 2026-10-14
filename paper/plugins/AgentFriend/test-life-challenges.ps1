$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$javaDir = 'E:\MC\jdk\jdk-21.0.12.1+1\bin'
$testBuild = Join-Path $root 'build-0.4.39-tests'
New-Item -ItemType Directory -Path $testBuild -Force | Out-Null
$gsonJar = Get-ChildItem 'E:\MC\server\libraries\com\google\code\gson\gson' -Recurse -Filter '*.jar' -File | Select-Object -First 1
$cp = (Join-Path $root 'build-0.4.39') + ';' + $gsonJar.FullName
& (Join-Path $javaDir 'javac.exe') -encoding UTF-8 -cp $cp -d $testBuild (Join-Path $root 'tests\org\afuhome\agentfriend\LifeChallengesTest.java')
if ($LASTEXITCODE -ne 0) { throw 'challenge test compilation failed' }
& (Join-Path $javaDir 'java.exe') -cp ($testBuild + ';' + $cp) org.afuhome.agentfriend.LifeChallengesTest
if ($LASTEXITCODE -ne 0) { throw 'challenge tests failed' }
