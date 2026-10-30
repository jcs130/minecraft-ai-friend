param([Parameter(Mandatory=$true)][string]$CandidateRoot)
$ErrorActionPreference='Stop'
$candidate=[IO.Path]::GetFullPath($CandidateRoot)
if(-not $candidate.StartsWith('E:\MC\ops\repairs\',[StringComparison]::OrdinalIgnoreCase)){throw 'Use a frozen repairs candidate'}
. (Join-Path $PSScriptRoot '../content-deploy.ps1')
function Listener {return $false}
function Log([string]$message){}
$targetRoot=Join-Path ([IO.Path]::GetTempPath()) ('qd-cooperation-'+[guid]::NewGuid().ToString('N'))
if([IO.Path]::GetPathRoot($targetRoot)-cne 'C:\'){throw 'Requires C: targets and E: sources'}
$template=Get-Content -LiteralPath (Join-Path $candidate 'frozen-plan.json') -Raw -Encoding UTF8|ConvertFrom-Json
function Test-Target([string]$relative){
 if($relative.StartsWith('ops/')){return Join-Path $opsDir $relative.Substring(4)}
 if(-not $relative.Contains('/')){return Join-Path (Join-Path $serverDir 'plugins') $relative}
 return Join-Path $serverDir $relative
}
$checks=0
foreach($phase in @('rollback','success','changed-preimage','running')){
 $serverDir=Join-Path $targetRoot ($phase+'/server');$opsDir=Join-Path $targetRoot ($phase+'/ops')
 New-Item -ItemType Directory -Path (Join-Path $serverDir 'plugins/MagicSpells'),$opsDir -Force|Out-Null
 $original=@{}
 foreach($row in @($template.files|Where-Object {$_.beforeSha256})){
  $target=Test-Target $row.target;New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force|Out-Null
  Copy-Item -LiteralPath (Join-Path $candidate ('before/'+[IO.Path]::GetFileName($target))) -Destination $target
  $original[$target]=(Get-FileHash -LiteralPath $target).Hash
 }
 foreach($row in $template.removeJars){$target=Test-Target $row.name;Copy-Item -LiteralPath (Join-Path $candidate ('before/'+$row.name)) -Destination $target;$original[$target]=(Get-FileHash -LiteralPath $target).Hash}
 $template.id='cooperation-test-'+$phase;$pending=Join-Path $opsDir 'content-plugins.pending.json'
 $template|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $pending -Encoding UTF8
 if($phase-eq 'changed-preimage'){$target=Test-Target 'plugins/AgentFriend/route-contracts.yml';Add-Content -LiteralPath $target -Value '# concurrent fixture change';$original[$target]=(Get-FileHash -LiteralPath $target).Hash}
 if($phase-eq 'running'){function Listener {return $true}}
 if($phase-eq 'rollback'){
  function Remove-Item([string]$LiteralPath,[switch]$Force){
   if([IO.Path]::GetFileName($LiteralPath)-ceq 'AgentFriend-0.4.47.37-rpg.jar'){throw 'Controlled old-build removal failure'}
   Microsoft.PowerShell.Management\Remove-Item -LiteralPath $LiteralPath -Force:$Force
  }
 }
 $failure=$null
 try{Deploy-PendingContent}catch{$failure=[string]$_}finally{if($phase-eq 'rollback'){Remove-Item Function:Remove-Item};function Listener{return $false}}
 if($phase-eq 'success'){
  if($failure){throw $failure}
  foreach($row in $template.files){if((Get-FileHash -LiteralPath (Test-Target $row.target)).Hash-ne $row.sha256){throw 'Installed bytes differ'};$checks++}
  foreach($row in $template.removeJars){if(Test-Path -LiteralPath (Test-Target $row.name)){throw 'Old JAR remains'};$checks++}
  if(Test-Path -LiteralPath $pending){throw 'Plan not consumed'};$checks++
  $journal=@(Get-Content -LiteralPath (Join-Path $opsDir ('repairs/'+$template.id+'/deployment-rollback/applied.json')) -Raw -Encoding UTF8|ConvertFrom-Json)
  if($journal.Count-ne (@($template.files).Count+@($template.removeJars).Count)-or @($journal|Where-Object {-not $_.Target-or -not $_.Backup}).Count){throw 'Recovery journal incomplete'};$checks++
 }else{
  $expected=switch($phase){'rollback'{'Controlled old-build removal failure'} 'changed-preimage'{'Content target changed'} 'running'{'Content deployment requires stopped Paper'}}
  if(-not $failure-or $failure-notmatch [regex]::Escape($expected)){throw "Expected refusal missing: $phase $failure"};$checks++
  foreach($target in $original.Keys){if((Get-FileHash -LiteralPath $target).Hash-cne $original[$target]){throw 'Preimage lost'};$checks++}
  foreach($row in @($template.files|Where-Object {-not $_.beforeSha256})){if(Test-Path -LiteralPath (Test-Target $row.target)){throw 'Unexpected new artifact after refusal'};$checks++}
  if(-not(Test-Path -LiteralPath $pending)){throw 'Refused plan consumed'};$checks++
 }
}
Write-Output ('Cooperative exploration: '+$checks+' real E:/C: install, rollback and refusal checks passed; fixture '+$targetRoot)
