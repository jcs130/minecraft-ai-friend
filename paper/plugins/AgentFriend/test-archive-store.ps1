param([string]$ServerRoot='E:/MC/server')
$ErrorActionPreference='Stop'
$archiveRoot=$PSScriptRoot
$archiveBuild=Join-Path $archiveRoot 'build-archive-tests'
$archiveJava='E:/MC/jdk/jdk-21.0.12.1+1/bin'
$archiveDriver=Join-Path $ServerRoot 'libraries/org/xerial/sqlite-jdbc/3.46.0.0/sqlite-jdbc-3.46.0.0.jar'
if(-not(Test-Path -LiteralPath $archiveDriver)){throw 'Prepare the pinned SQLite 3.46.0.0 driver first'}
$archiveLogger=Get-ChildItem -LiteralPath (Join-Path $ServerRoot 'libraries/org/slf4j/slf4j-api') -Recurse -Filter '*.jar' | Sort-Object FullName -Descending | Select-Object -First 1
New-Item -ItemType Directory -Path $archiveBuild -Force | Out-Null
& (Join-Path $archiveJava 'javac.exe') -encoding UTF-8 -d $archiveBuild (Join-Path $archiveRoot 'src/org/afuhome/agentfriend/ArchiveStore.java') (Join-Path $archiveRoot 'tests/org/afuhome/agentfriend/ArchiveStoreTest.java')
if($LASTEXITCODE -ne 0){throw 'Archive database tests failed to compile'}
$archiveClasspath=$archiveBuild+';'+$archiveDriver+';'+$archiveLogger.FullName
& (Join-Path $archiveJava 'java.exe') -Xint -Xmx128m -XX:ActiveProcessorCount=2 -cp $archiveClasspath org.afuhome.agentfriend.ArchiveStoreTest
if($LASTEXITCODE -ne 0){throw 'Archive database tests failed'}
