param([Parameter(Mandatory=$true)][string]$CandidateRoot)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../content-deploy.ps1')
$taskChecks=0
foreach($case in @(
 @('plugins/WorldGuard/worlds/aincrad/regions.yml',$true),
 @('plugins/WorldGuard/worlds/aincrad/config.yml',$true),
 @('plugins/WorldGuard/worlds/world/regions.yml',$false),
 @('plugins/WorldGuard/config.yml',$false),
 @('plugins/WorldGuard/worlds/aincrad/../world/regions.yml',$false),
 @('plugins/WorldGuard/worlds/AINCRAD/regions.yml',$false),
 @('plugins/WorldGuard/worlds/aincrad/config.yml.bak',$false)
)){if((Content-AincradProtectionTarget $case[0]) -ne $case[1]){throw 'target boundary'};$taskChecks++}
$taskSource=[IO.Path]::GetFullPath($CandidateRoot)
if(-not $taskSource.StartsWith('E:\MC\ops\repairs\',[StringComparison]::OrdinalIgnoreCase)){throw 'isolated root required'}
$taskRoot=Join-Path $taskSource ('deploy-fixture-'+[guid]::NewGuid().ToString('N'))
$serverDir=Join-Path $taskRoot 'server';$opsDir=Join-Path $taskRoot 'ops'
New-Item -ItemType Directory -Path $serverDir,$opsDir -Force | Out-Null
$script:taskListening=$false
function Listener{return $script:taskListening}
function Log([string]$text){}
$taskFile=@{source=(Join-Path $taskSource 'candidate/plugins/WorldGuard/worlds/aincrad/regions.yml');target='plugins/WorldGuard/worlds/aincrad/regions.yml'}
$taskFile.sha256=(Get-FileHash -LiteralPath $taskFile.source -Algorithm SHA256).Hash
function Plan($file){@{schema=1;id=('aincrad-test-'+[guid]::NewGuid().ToString('N'));files=@($file);removeJars=@()}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $opsDir 'content-plugins.pending.json') -Encoding UTF8}
function Refuse($file,$reason){Plan $file;$failed=$false;try{Deploy-PendingContent}catch{if($_ -notmatch $reason){throw};$failed=$true};if(-not $failed){throw "unsafe plan accepted: $reason"};$script:taskChecks++}
$script:taskListening=$true;Refuse $taskFile 'requires stopped Paper';$script:taskListening=$false
$bad=$taskFile.Clone();$bad.sha256='0'*64;Refuse $bad 'source hash mismatch'
$bad=$taskFile.Clone();$bad.target='plugins/WorldGuard/worlds/other_world/regions.yml';Refuse $bad 'Unexpected content target'
Plan $taskFile;Deploy-PendingContent
if((Get-FileHash (Join-Path $serverDir $taskFile.target)).Hash -ne $taskFile.sha256){throw 'install mismatch'};$taskChecks++
Refuse $taskFile 'unrecorded file'
$bad=$taskFile.Clone();$bad.beforeSha256='0'*64;Refuse $bad 'target changed'
$taskFile.beforeSha256=$taskFile.sha256;Plan $taskFile;Deploy-PendingContent
if((Get-FileHash (Join-Path $serverDir $taskFile.target)).Hash -ne $taskFile.sha256){throw 'replacement mismatch'};$taskChecks++
if(-not (Get-ChildItem (Join-Path $opsDir repairs) -Recurse -Filter '0.original')){throw 'rollback missing'};$taskChecks++
Write-Output "Aincrad installer: $taskChecks checks passed; production untouched"
