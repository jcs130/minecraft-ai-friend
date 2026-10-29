param([Parameter(Mandatory=$true)][string]$OpsFixture,[Parameter(Mandatory=$true)][string]$ServerFixture)
$ErrorActionPreference='Stop'
$ops=[IO.Path]::GetFullPath($OpsFixture);$server=[IO.Path]::GetFullPath($ServerFixture)
$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
if(-not $ops.StartsWith('E:\MC\ops\repairs\', [StringComparison]::OrdinalIgnoreCase)-or-not $server.StartsWith(($temp+'\'),[StringComparison]::OrdinalIgnoreCase)-or[IO.Path]::GetPathRoot($ops)-eq[IO.Path]::GetPathRoot($server)){throw 'Use unused test directories on distinct volumes, under repairs and user temp'}
if((Test-Path -LiteralPath $ops)-or(Test-Path -LiteralPath $server)){throw 'Fixture already exists; inspect rather than replay'}
$null=New-Item -ItemType Directory -Path $ops,(Join-Path $server 'plugins'),(Join-Path $ops 'sources')
[IO.File]::WriteAllText((Join-Path $ops '.qa-only'),'CONTENT_DEPLOY_VOLUME_ONLY')
$script:opsDir=$ops;$script:serverDir=$server;$script:contentRecoveryBlocked=$false
$helper=Join-Path (Split-Path -Parent $PSScriptRoot) 'ops\content-deploy.ps1'
. $helper
function Listener { @() }
$script:messages=@()
function Log([string]$text){$script:messages+=$text}
$checks=@()
function Plan([string]$id,[string[]]$names){
 $rows=@()
 foreach($name in $names){
  $old=Join-Path $server ('plugins\'+$name);$source=Join-Path $ops ('sources\'+$name)
  [IO.File]::WriteAllText($old,'old-'+$name);[IO.File]::WriteAllText($source,'new-'+$name)
  $rows+=@{source=$source;target=$name;sha256=(Get-FileHash -LiteralPath $source).Hash.ToLowerInvariant();beforeSha256=(Get-FileHash -LiteralPath $old).Hash.ToLowerInvariant()}
 }
 $plan=@{schema=1;id=$id;files=$rows;removeJars=@()}
 $plan|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $ops 'content-plugins.pending.json') -Encoding UTF8
 return $plan
}
$one=Plan 'content-volume-success-20261029' @('AgentFriend-9.8.1.jar')
Deploy-PendingContent
if([IO.File]::ReadAllText((Join-Path $server 'plugins\AgentFriend-9.8.1.jar'))-cne'new-AgentFriend-9.8.1.jar'){throw 'Actual native helper did not replace cross-volume target'}
$checks+='native helper replaces C target while recovery copy stays on E'
$receipt=Get-Content -LiteralPath (Join-Path $ops 'repairs\content-volume-success-20261029\deployment-rollback\applied.json') -Raw|ConvertFrom-Json
if(-not$receipt.Target-or-not$receipt.Backup-or[IO.File]::ReadAllText($receipt.Backup)-cne'old-AgentFriend-9.8.1.jar'){throw 'Recovery preimage or journal lost'}
$checks+='real rollback journal retains original bytes and concrete paths'
$bad=Plan 'content-volume-hash-reject-20261029' @('AgentFriend-9.8.2.jar');$bad.files[0].sha256='0'*64
$bad|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $ops 'content-plugins.pending.json') -Encoding UTF8
$rejected=$false;try{Deploy-PendingContent}catch{$rejected=$_.Exception.Message-match'Content source hash mismatch'}
if(-not$rejected-or[IO.File]::ReadAllText((Join-Path $server 'plugins\AgentFriend-9.8.2.jar'))-cne'old-AgentFriend-9.8.2.jar'){throw 'Bad candidate hash altered the target'}
$checks+='bad source hash is rejected before modifying target'
$two=Plan 'content-volume-blocked-rollback-20261029' @('AgentFriend-9.8.3.jar','AgentFriend-9.8.4.jar')
$script:blockTrigger=Join-Path $server 'plugins\AgentFriend-9.8.4.jar';$script:lockTarget=Join-Path $server 'plugins\AgentFriend-9.8.3.jar';$script:held=$null
function Copy-Item {
 param([string]$LiteralPath,[string]$Destination,[switch]$Force)
 if($LiteralPath-ceq$script:blockTrigger){$script:held=[IO.File]::Open($script:lockTarget,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);throw 'injected fixture interruption'}
 Microsoft.PowerShell.Management\Copy-Item @PSBoundParameters
}
$failed=$false
try{Deploy-PendingContent}catch{$failed=$_.Exception.Message-match'injected fixture interruption'}finally{if($script:held){$script:held.Dispose()};Remove-Item -LiteralPath Function:\Copy-Item}
if(-not$failed-or-not$script:contentRecoveryBlocked){throw 'Incomplete rollback did not block caller startup'}
$checks+='actual Windows write lock during rollback sets recovery-blocked flag'
$restore=Join-Path $ops 'repairs\content-volume-blocked-rollback-20261029\deployment-rollback\0.original'
Microsoft.PowerShell.Management\Copy-Item -LiteralPath $restore -Destination $script:lockTarget -Force
if([IO.File]::ReadAllText($script:lockTarget)-cne'old-AgentFriend-9.8.3.jar'){throw 'Fixture recovery failed'}
$checks+='fixture can recover old target after the lock is released'
$report=@{passed=$true;checks=$checks;gameFilesChanged=$false;helperSha256=(Get-FileHash -LiteralPath $helper).Hash.ToLowerInvariant()}
$report|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $ops 'result.json') -Encoding UTF8
$report|ConvertTo-Json -Depth 5 -Compress
