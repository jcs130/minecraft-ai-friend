param(
    [Parameter(Mandatory)][string]$GsonJar,
    [Parameter(Mandatory)][string]$JnaJar,
    [Parameter(Mandatory)][string]$ResultDirectory,
    [string]$JavaBin
)
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '../../plugins/AgentFriend/src/org/afuhome/agentfriend'
$classes = Join-Path $ResultDirectory 'classes'
$fixture = Join-Path $ResultDirectory ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $classes | Out-Null
$cp = (Resolve-Path -LiteralPath $GsonJar).Path + [IO.Path]::PathSeparator + (Resolve-Path -LiteralPath $JnaJar).Path
$javac = if ($JavaBin) { Join-Path $JavaBin 'javac' } else { 'javac' }
$java = if ($JavaBin) { Join-Path $JavaBin 'java' } else { 'java' }
$files = @('DurableFileMove.java','AtomicConfigFile.java','DurableConfigFiles.java','CryptTemporaryBlocks.java','CryptCleanupReceipts.java') | ForEach-Object { Join-Path $source $_ }
$files += @(Join-Path $PSScriptRoot 'CryptTemporaryBlocksTest.java')
$files += @(Join-Path $PSScriptRoot 'CryptCleanupReceiptsTest.java')
& $javac -encoding UTF-8 -d $classes -cp $cp @files
if ($LASTEXITCODE -ne 0) { throw 'Candidate compilation failed' }
$body = & $java -cp ($classes + [IO.Path]::PathSeparator + $cp) 'org.afuhome.agentfriend.CryptTemporaryBlocksTest' $fixture
if ($LASTEXITCODE -ne 0) { throw 'Candidate replay failed' }
$summary = $body | ConvertFrom-Json
if ($summary.count -ne $summary.passed.Count -or $summary.actualServerConnected -ne $false) { throw 'Invalid fixture receipt' }
$body | Set-Content -LiteralPath (Join-Path $ResultDirectory 'lease-replay.json') -Encoding utf8
Write-Output "$($summary.count) cases passed using $($summary.journal) and $($summary.terrain) terrain."
