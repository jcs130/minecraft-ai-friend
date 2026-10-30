param([Parameter(Mandatory=$true)][string]$CandidateRoot,[Parameter(Mandatory=$true)][string]$PreviousPlugins)
$ErrorActionPreference='Stop'
$candidate=[IO.Path]::GetFullPath($CandidateRoot)
if(-not $candidate.StartsWith('E:\MC\ops\repairs\',[StringComparison]::OrdinalIgnoreCase)){throw 'Use a private repairs candidate'}
. (Join-Path $PSScriptRoot '../content-deploy.ps1')
function Listener {return $false}
function Log([string]$message){}
$fixture=Join-Path $candidate ('content-fixture-'+[guid]::NewGuid().ToString('N'))
$targetRoot=Join-Path ([IO.Path]::GetTempPath()) ('qd-content-'+[guid]::NewGuid().ToString('N'))
if([IO.Path]::GetPathRoot($targetRoot)-cne 'C:\'){throw 'This regression requires a C: target and E: sources'}
$original=@('AgentFriend-0.4.47.36-compat.jar','VortexRPG-1.2.2-alpha-qd29.jar','QiandengjiRpg-0.2.10.jar')
$template=Get-Content -LiteralPath (Join-Path $candidate 'frozen-plan.json') -Raw -Encoding UTF8|ConvertFrom-Json
$checks=0
foreach($phase in @('rollback','success')){
 $serverDir=Join-Path $targetRoot $phase;$opsDir=Join-Path $fixture $phase
 New-Item -ItemType Directory -Path (Join-Path $serverDir 'plugins'),$opsDir -Force|Out-Null
 foreach($name in $original){Copy-Item -LiteralPath (Join-Path $PreviousPlugins $name) -Destination (Join-Path (Join-Path $serverDir 'plugins') $name)}
 $before=@{};foreach($name in $original){$before[$name]=(Get-FileHash -LiteralPath (Join-Path (Join-Path $serverDir 'plugins') $name)).Hash}
 $template.id='first-party-build-'+$phase
 $pending=Join-Path $opsDir 'content-plugins.pending.json';$template|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $pending -Encoding UTF8
 if($phase-eq 'rollback'){
  function Remove-Item([string]$LiteralPath,[switch]$Force){
   if([IO.Path]::GetFileName($LiteralPath)-ceq 'AgentFriend-0.4.47.36-compat.jar'){throw 'Controlled old-build removal failure'}
   Microsoft.PowerShell.Management\Remove-Item -LiteralPath $LiteralPath -Force:$Force
  }
  $refused=$false
  try{Deploy-PendingContent}catch{if($_-notmatch 'Controlled old-build removal failure'){throw};$refused=$true}finally{Remove-Item Function:Remove-Item}
  if(-not $refused){throw 'Controlled failure was not exercised'};$checks++
  $after=@{};foreach($file in Get-ChildItem -LiteralPath (Join-Path $serverDir 'plugins') -File){$after[$file.Name]=(Get-FileHash -LiteralPath $file.FullName).Hash}
  if($after.Count-ne $before.Count){throw 'Rollback changed plugin set'};$checks++
  foreach($name in $original){if($after[$name]-cne $before[$name]){throw 'Rollback did not preserve preimage'};$checks++}
 }else{
  Deploy-PendingContent
  foreach($row in $template.files){if((Get-FileHash -LiteralPath (Join-Path (Join-Path $serverDir 'plugins') $row.target)).Hash-ne $row.sha256){throw 'Installed bytes differ'};$checks++}
  if(Test-Path -LiteralPath (Join-Path (Join-Path $serverDir 'plugins') $original[0])){throw 'Previous build was not removed'};$checks++
  if(Test-Path -LiteralPath $pending){throw 'Plan was not consumed'};$checks++
  if(-not(Test-Path -LiteralPath (Join-Path $opsDir 'repairs/first-party-build-success/deployment-rollback/consumed-plan.json'))){throw 'Missing consumed receipt'};$checks++
 }
}
Write-Output ('First-party builds: '+$checks+' real E:/C: install/rollback checks passed; retained fixture '+$targetRoot)
