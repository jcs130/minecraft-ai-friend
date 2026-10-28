$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../content-deploy.ps1')
$taskRoot=Join-Path 'E:\MC\ops\repairs\basic-survival-release-20261028' ('observer-fixture-'+[guid]::NewGuid().ToString('N'))
$serverDir=Join-Path $taskRoot server
$opsDir=Join-Path $taskRoot ops
New-Item -ItemType Directory -Path $serverDir,$opsDir -Force | Out-Null
function Listener{return $false}
function Log([string]$text){}
$taskOld=@(@{uuid='b2f9ceb0-8271-3470-b99f-e1c3ffe4edbd';name='Goddess';level=4;bypassesPlayerLimit=$false})
$taskLive=@{uuid='4e620aee-9f79-368f-9919-34e608edf0c3';name='live';level=4;bypassesPlayerLimit=$false}
$taskTarget=Join-Path $serverDir 'ops.json'
$taskSource=Join-Path $taskRoot 'candidate-ops.json'
ConvertTo-Json -InputObject @($taskOld) -Depth 8 | Set-Content -LiteralPath $taskTarget -Encoding UTF8
function Plan([string]$id,$rows){
 ConvertTo-Json -InputObject @($rows) -Depth 8 | Set-Content -LiteralPath $taskSource -Encoding UTF8
 @{schema=1;id=$id;files=@(@{source=$taskSource;target='ops.json';sha256=(Get-FileHash -LiteralPath $taskSource).Hash;beforeSha256=(Get-FileHash -LiteralPath $taskTarget).Hash});removeJars=@()} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $opsDir 'content-plugins.pending.json') -Encoding UTF8
}
function Refused([string]$id,$rows){Plan $id $rows;$failed=$false;try{Deploy-PendingContent}catch{$failed=$true};if(-not $failed){throw 'Unapproved operator change accepted'}}
Refused 'unapproved-other-release' @($taskOld+$taskLive)
$taskBad=@{}+$taskLive;$taskBad.name='impostor'
Refused 'basic-survival-release-20261028' @($taskOld+$taskBad)
$taskChanged=@{}+$taskOld[0];$taskChanged.level=1
Refused 'basic-survival-release-20261028' @($taskChanged,$taskLive)
$taskBad=@{}+$taskLive;$taskBad.bypassesPlayerLimit=$true
Refused 'basic-survival-release-20261028' @($taskOld+$taskBad)
Plan 'basic-survival-release-20261028' @($taskOld+$taskLive)
Deploy-PendingContent
$taskRows=Get-Content -LiteralPath $taskTarget -Raw -Encoding UTF8 | ConvertFrom-Json
if($taskRows.Count -ne 2 -or $taskRows[1].name -cne 'live' -or $taskRows[0].level -ne 4){throw 'Approved fixture mismatch'}
'Live observer operator deployment: 5 checks passed; no production changes'
