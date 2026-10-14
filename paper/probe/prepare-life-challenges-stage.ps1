# Local QA only. Copy an already stopped, isolated world; never production player data.
$ErrorActionPreference='Stop'
$challengeStage='E:/MC/staging/life-challenges-20261014/paper'
$challengeSource='E:/MC/staging/exploration-gallery-20261014/paper'
if(Test-Path -LiteralPath $challengeStage){throw 'Stage already exists; retain its evidence and use the existing instance deliberately'}
if(Get-NetTCPConnection -State Listen -LocalPort 25674 -ErrorAction SilentlyContinue){throw 'Source stage is running'}
if(Get-NetTCPConnection -State Listen -LocalPort 25678,25679 -ErrorAction SilentlyContinue){throw 'QA ports occupied'}
if(Get-NetUDPEndpoint -LocalPort 19182 -ErrorAction SilentlyContinue){throw 'QA Bedrock port occupied'}
$sourceProperties=[IO.File]::ReadAllText((Join-Path $challengeSource 'server.properties'))
if($sourceProperties -notmatch '(?m)^motd=Photo gallery isolated check\r?$' -or $sourceProperties -notmatch '(?m)^server-ip=127\.0\.0\.1\r?$'){throw 'Unexpected source'}
New-Item -ItemType Directory -Path $challengeStage -Force | Out-Null
robocopy $challengeSource $challengeStage /E /XD logs /XF session.lock /R:0 /W:0 /NFL /NDL /NJH /NJS /NP
if($LASTEXITCODE -gt 7){throw 'Isolated copy failed'}
$utf8Challenge=New-Object System.Text.UTF8Encoding($false)
$propertiesFile=Join-Path $challengeStage 'server.properties'
$properties=[IO.File]::ReadAllText($propertiesFile) -replace '(?m)^server-port=.*$','server-port=25678' -replace '(?m)^rcon.port=.*$','rcon.port=25679' -replace '(?m)^motd=.*$','motd=Life challenges isolated check'
[IO.File]::WriteAllText($propertiesFile,$properties,$utf8Challenge)
$geyser=Join-Path $challengeStage 'plugins/Geyser-Spigot/config.yml'
[IO.File]::WriteAllText($geyser,([IO.File]::ReadAllText($geyser).Replace('19178','19182').Replace('25674','25678')),$utf8Challenge)
$image=Join-Path $challengeStage 'plugins/ImageFrame/config.yml'
[IO.File]::WriteAllText($image,([IO.File]::ReadAllText($image).Replace('Port: 8523','Port: 8527')),$utf8Challenge)
$oldJar=Join-Path $challengeStage 'plugins/AgentFriend-0.4.37.jar'
Move-Item -LiteralPath $oldJar -Destination ($oldJar+'.disabled')
$sourceRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Copy-Item -LiteralPath (Join-Path $sourceRoot 'paper/plugins/AgentFriend/AgentFriend-0.4.39.jar') -Destination ($challengeStage+'/plugins')
Copy-Item -LiteralPath E:/MC/server/plugins/Minepacks-2.5.9-Release.jar -Destination ($challengeStage+'/plugins')
New-Item -ItemType Directory -Path ($challengeStage+'/plugins/Minepacks') -Force | Out-Null
Copy-Item -LiteralPath E:/MC/server/plugins/Minepacks/config.yml -Destination ($challengeStage+'/plugins/Minepacks/config.yml')
$challengeFixtureBuild=Join-Path $challengeStage 'qa-fixture-build'
New-Item -ItemType Directory -Path $challengeFixtureBuild -Force | Out-Null
$challengeClasspath=(Get-ChildItem -LiteralPath 'E:/MC/server/libraries' -Recurse -Filter '*.jar' -File | ForEach-Object { $_.FullName }) -join ';'
& 'E:/MC/jdk/jdk-21.0.12.1+1/bin/javac.exe' -proc:none -encoding UTF-8 -cp $challengeClasspath -d $challengeFixtureBuild (Join-Path $PSScriptRoot 'fixtures/LifeChallengeQA.java')
if($LASTEXITCODE -ne 0){throw 'QA fixture compilation failed'}
$challengeFixtureYaml="name: LifeChallengeQA`nversion: '1.0'`nmain: LifeChallengeQA`napi-version: '1.20'`ndepend: [AgentFriend]`ncommands:`n  lifeqa: {description: Loopback-only test fixtures}`n"
[IO.File]::WriteAllText((Join-Path $challengeFixtureBuild 'plugin.yml'),$challengeFixtureYaml,$utf8Challenge)
& 'E:/MC/jdk/jdk-21.0.12.1+1/bin/jar.exe' --create --file (Join-Path $challengeStage 'plugins/LifeChallengeQA.jar') -C $challengeFixtureBuild .
if($LASTEXITCODE -ne 0){throw 'QA fixture packaging failed'}
Write-Output 'Isolated stage prepared at 127.0.0.1:25678; RCON 25679; Bedrock 19182; ImageFrame 8527. No service started.'
exit 0
