param([Parameter(Mandatory=$true)][string]$CandidateRoot)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../content-deploy.ps1')
foreach($taskCase in @(
    @('AgentVision-0.1.0.jar',$true),
    @('AgentVision-0.1.1.jar',$true),
    @('AgentVision-0.1.2.jar',$true),
    @('AgentVision-0.1.3.jar',$false),
    @('agentvision-0.1.0.jar',$false),
    @('../AgentVision-0.1.0.jar',$false),
    @('AgentVision-0.1.0.jar.disabled',$false),
    @('AgentVision-0.1.0.jar/elsewhere',$false)
)) { if((Content-AgentVisionJar $taskCase[0]) -ne $taskCase[1]) { throw 'AgentVision artifact boundary failed' } }
$taskSource=[IO.Path]::GetFullPath($CandidateRoot)
if(-not $taskSource.StartsWith('E:\MC\ops\repairs\',[StringComparison]::OrdinalIgnoreCase)){throw 'Use a private candidate'}
$taskRoot=Join-Path $taskSource ('deployment-fixture-'+[guid]::NewGuid().ToString('N'))
$serverDir=Join-Path $taskRoot 'server'
$opsDir=Join-Path $taskRoot 'ops'
New-Item -ItemType Directory -Path (Join-Path $serverDir 'plugins'),$opsDir -Force | Out-Null
$script:taskListening=$false
function Listener{return $script:taskListening}
function Log([string]$text){}
$taskName='AgentVision-0.1.2.jar'
$taskFile=@{source=(Join-Path $taskSource $taskName);target=$taskName;sha256=(Get-FileHash -LiteralPath (Join-Path $taskSource $taskName) -Algorithm SHA256).Hash}
function TaskPlan($id,$file,$remove=@()){@{schema=1;id=$id;files=@($file);removeJars=@($remove)}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $opsDir 'content-plugins.pending.json') -Encoding UTF8}
function Refuse($id,$file,$reason){
    TaskPlan $id $file
    $failed=$false
    try{Deploy-PendingContent}catch{if($_ -notmatch $reason){throw};$failed=$true}
    if(-not $failed){throw 'Unsafe AgentVision deployment accepted'}
    if(@(Get-ChildItem -LiteralPath $serverDir -Recurse -File).Count){throw 'Rejected deployment wrote target'}
}
$script:taskListening=$true
Refuse 'vision-fixture-running' $taskFile 'requires stopped Paper'
$script:taskListening=$false
$bad=$taskFile.Clone();$bad.sha256='0'*64
Refuse 'vision-fixture-hash' $bad 'source hash mismatch'
$bad=$taskFile.Clone();$bad.target='AgentVision-0.1.3.jar'
Refuse 'vision-fixture-version' $bad 'Unexpected plugin JAR'
foreach($taskBadRemoval in @('AgentVision-0.1.3.jar','../AgentVision-0.1.0.jar')) {
    TaskPlan ('vision-fixture-remove-'+[guid]::NewGuid().ToString('N')) $taskFile @(@{name=$taskBadRemoval;sha256=$taskFile.sha256})
    $failed=$false
    try{Deploy-PendingContent}catch{if($_ -notmatch 'Only previous first-party plugin JAR may be removed'){throw};$failed=$true}
    if(-not $failed){throw 'Unsafe AgentVision removal accepted'}
    if(@(Get-ChildItem -LiteralPath $serverDir -Recurse -File).Count){throw 'Rejected removal wrote target'}
}
$taskOldName='AgentVision-0.1.0.jar'
Copy-Item -LiteralPath $taskFile.source -Destination (Join-Path $serverDir ('plugins/'+$taskOldName))
TaskPlan 'vision-fixture-success' $taskFile @(@{name=$taskOldName;sha256=$taskFile.sha256})
Deploy-PendingContent
if((Get-FileHash -LiteralPath (Join-Path $serverDir ('plugins/'+$taskName)) -Algorithm SHA256).Hash -ne $taskFile.sha256){throw 'Installed AgentVision mismatch'}
if(Test-Path -LiteralPath (Join-Path $opsDir 'content-plugins.pending.json')){throw 'Plan not consumed'}
if(Test-Path -LiteralPath (Join-Path $serverDir ('plugins/'+$taskOldName))){throw 'Previous AgentVision was left installed'}
if((Get-FileHash -LiteralPath (Join-Path $opsDir 'repairs/vision-fixture-success/deployment-rollback/1.original') -Algorithm SHA256).Hash -ne $taskFile.sha256){throw 'Removed AgentVision rollback copy missing'}
Write-Output 'AgentVision deploy: 16 boundary, stopped-service, hash, removal and rollback checks passed; production untouched'
