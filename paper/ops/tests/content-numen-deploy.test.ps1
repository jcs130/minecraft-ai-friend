param([Parameter(Mandatory=$true)][string]$CandidateRoot)
$ErrorActionPreference='Stop'
$taskSource=[IO.Path]::GetFullPath($CandidateRoot)
if(-not $taskSource.StartsWith('E:\MC\ops\repairs\',[StringComparison]::OrdinalIgnoreCase)){throw 'Use a private repairs candidate'}
$taskRoot=Join-Path $taskSource ('deployment-fixture-'+[guid]::NewGuid().ToString('N'))
$serverDir=Join-Path $taskRoot 'server'
$opsDir=Join-Path $taskRoot 'ops'
New-Item -ItemType Directory -Path $serverDir,$opsDir -Force | Out-Null
$script:taskListening=$false
function Listener{return $script:taskListening}
function Log([string]$text){}
. (Join-Path $PSScriptRoot '../content-deploy.ps1')
$taskTargets=@('numen_api-paper-1.21.1-0.1.4.jar','numen-paper-1.21.1-0.1.4.jar','plugins/numen/server/server.json','plugins/numen/server/mcp_server.json','NumenBedrock-0.1.0.jar')
$taskFiles=@($taskTargets | ForEach-Object {
    $source=Join-Path $taskSource $_
    if(-not(Test-Path -LiteralPath $source)){throw ('Missing candidate: '+$_)}
    @{source=$source;target=$_;sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash}
})
function Task-Plan([string]$id,$files){@{schema=1;id=$id;files=@($files);removeJars=@()} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $opsDir 'content-plugins.pending.json') -Encoding UTF8}
function Task-Refused([string]$id,$files,[string]$reason){
    Task-Plan $id $files
    $refused=$false
    try{Deploy-PendingContent}catch{if($_ -notmatch $reason){throw};$refused=$true}
    if(-not $refused){throw ('Unsafe plan accepted: '+$id)}
    if(@(Get-ChildItem -LiteralPath $serverDir -Recurse -File).Count){throw 'Rejected plan installed files'}
}
$script:taskListening=$true
Task-Refused 'numen-fixture-running' $taskFiles 'requires stopped Paper'
$script:taskListening=$false
$taskBad=@{source=$taskFiles[0].source;target=$taskFiles[0].target;sha256=('0'*64)}
Task-Refused 'numen-fixture-hash' @($taskBad) 'source hash mismatch'
$taskBad=@{source=$taskFiles[0].source;target='numen-fabric-1.21.1-0.1.4.jar';sha256=$taskFiles[0].sha256}
Task-Refused 'numen-fixture-loader' @($taskBad) 'Unexpected plugin JAR'
$taskBad=@{source=$taskFiles[2].source;target='plugins/numen/server/keys.json';sha256=$taskFiles[2].sha256}
Task-Refused 'numen-fixture-keyfile' @($taskBad) 'Unexpected content target'
$taskBad=@{source=$taskFiles[2].source;target='plugins/numen/server/../keys.json';sha256=$taskFiles[2].sha256}
Task-Refused 'numen-fixture-traversal' @($taskBad) 'Unexpected content target'
# Force an error on the second atomic move and verify that the first new JAR
# is rolled back. All paths belong to this fresh fixture, never the live server.
function Move-Item([string]$LiteralPath,[string]$Destination){
    if([IO.Path]::GetFileName($Destination) -eq 'numen-paper-1.21.1-0.1.4.jar'){throw 'Controlled second-file failure'}
    Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination
}
try{Task-Refused 'numen-fixture-rollback' $taskFiles 'Controlled second-file failure'}
finally{Remove-Item Function:Move-Item}
Task-Plan 'numen-fixture-valid' $taskFiles
Deploy-PendingContent
foreach($file in $taskFiles){
    $target=if($file.target.StartsWith('plugins/')){Join-Path $serverDir $file.target}else{Join-Path $serverDir ('plugins/'+$file.target)}
    if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $file.sha256){throw 'Installed digest differs'}
}
$taskJournal=Join-Path $opsDir 'repairs/numen-fixture-valid/deployment-rollback/applied.json'
$taskJournalEntries=Get-Content -LiteralPath $taskJournal -Raw | ConvertFrom-Json
# Windows PowerShell 5.1 returns a JSON array as one pipeline object; enumerate
# the assigned array so this checks all installed entries on both shells.
if(@($taskJournalEntries).Count -ne $taskTargets.Count){throw 'Incomplete deployment journal'}
if(Test-Path -LiteralPath (Join-Path $opsDir 'content-plugins.pending.json')){throw 'Plan not consumed'}
Write-Output ('Numen stopped deployment: 7 cases passed; fixture '+$taskRoot)
