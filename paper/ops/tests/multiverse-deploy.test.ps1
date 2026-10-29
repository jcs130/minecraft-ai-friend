param([Parameter(Mandatory=$true)][string]$CandidateRoot)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../content-deploy.ps1')
$checks=0
foreach($case in @(
 @('Multiverse-Core-5.8.1.jar',$true),@('plugins/Multiverse-Core/config.yml',$true),
 @('Multiverse-Core-5.8.2.jar',$false),@('Multiverse-Inventories-5.0.0.jar',$false),
 @('plugins/Multiverse-Core/worlds.yml',$false),@('plugins/Multiverse-Core/../LuckPerms/config.yml',$false),
 @('plugins/multiverse-core/config.yml',$false)
)){if((Content-MultiverseTarget $case[0]) -ne $case[1]){throw 'target boundary'};$checks++}
if(Content-MultiverseJar 'plugins/Multiverse-Core/config.yml'){throw 'config accepted as removable jar'};$checks++
$inputRoot=([IO.Path]::GetFullPath($CandidateRoot)).Replace([char]92,[char]47)
if(-not $inputRoot.StartsWith('E:/MC/ops/repairs/',[StringComparison]::OrdinalIgnoreCase)){throw 'isolated root required'}
$fixture=Join-Path $inputRoot ('mv-install-'+[guid]::NewGuid().ToString('N'))
$serverDir=Join-Path $fixture 'server';$opsDir=Join-Path $fixture 'ops';New-Item -ItemType Directory -Path $serverDir,$opsDir -Force | Out-Null
$script:listening=$false
function Listener{return $script:listening}
function Log([string]$text){}
function Plan($file,$remove=@()){@{schema=1;id=('mv-test-'+[guid]::NewGuid().ToString('N'));files=@($file);removeJars=@($remove)}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $opsDir 'content-plugins.pending.json') -Encoding UTF8}
function Refuse($file,$reason){Plan $file;$failed=$false;try{Deploy-PendingContent}catch{if($_ -notmatch $reason){throw};$failed=$true};if(-not $failed){throw "unsafe plan accepted: $reason"};$script:checks++}
$file=@{source=(Join-Path $inputRoot 'candidate/plugins/Multiverse-Core/config.yml');target='plugins/Multiverse-Core/config.yml'};$file.sha256=(Get-FileHash -LiteralPath $file.source).Hash
$script:listening=$true;Refuse $file 'requires stopped Paper';$script:listening=$false
$bad=$file.Clone();$bad.sha256='0'*64;Refuse $bad 'source hash mismatch'
$bad=$file.Clone();$bad.target='plugins/Multiverse-Core/worlds.yml';Refuse $bad 'Unexpected content target'
Plan $file;Deploy-PendingContent
if((Get-FileHash -LiteralPath (Join-Path $serverDir $file.target)).Hash -ne $file.sha256){throw 'config installation mismatch'};$checks++
Refuse $file 'unrecorded file'
$bad=$file.Clone();$bad.beforeSha256='0'*64;Refuse $bad 'target changed'
$file.beforeSha256=$file.sha256;Plan $file;Deploy-PendingContent
if(-not(Get-ChildItem -LiteralPath (Join-Path $opsDir 'repairs') -Recurse -Filter '0.original')){throw 'rollback absent'};$checks++
$jar=@{source=(Join-Path $inputRoot 'candidate/Multiverse-Core-5.8.1.jar');target='Multiverse-Core-5.8.1.jar'};$jar.sha256=(Get-FileHash -LiteralPath $jar.source).Hash
Plan $jar;Deploy-PendingContent
if((Get-FileHash -LiteralPath (Join-Path $serverDir ('plugins/'+$jar.target))).Hash -ne $jar.sha256){throw 'jar installation mismatch'};$checks++
$plan=@{schema=1;id=('mv-remove-'+[guid]::NewGuid().ToString('N'));files=@();removeJars=@(@{name=$jar.target;sha256=$jar.sha256})};$plan|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $opsDir 'content-plugins.pending.json') -Encoding UTF8
Deploy-PendingContent
if(Test-Path -LiteralPath (Join-Path $serverDir ('plugins/'+$jar.target))){throw 'exact rollback failed'};$checks++
Write-Output "Multiverse installer: $checks checks passed; production untouched"
