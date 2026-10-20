param([Parameter(Mandatory=$true)][string]$CandidateRoot)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../content-deploy.ps1')
foreach($taskCase in @(
    @('AgentVision-0.1.0.jar',$true),
    @('AgentVision-0.1.1.jar',$false),
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
$taskName='AgentVision-0.1.0.jar'
$taskFile=@{source=(Join-Path $taskSource $taskName);target=$taskName;sha256=(Get-FileHash -LiteralPath (Join-Path $taskSource $taskName) -Algorithm SHA256).Hash}
function TaskPlan($id,$file){@{schema=1;id=$id;files=@($file);removeJars=@()}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $opsDir 'content-plugins.pending.json') -Encoding UTF8}
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
$bad=$taskFile.Clone();$bad.target='AgentVision-0.1.1.jar'
Refuse 'vision-fixture-version' $bad 'Unexpected plugin JAR'
TaskPlan 'vision-fixture-success' $taskFile
Deploy-PendingContent
if((Get-FileHash -LiteralPath (Join-Path $serverDir ('plugins/'+$taskName)) -Algorithm SHA256).Hash -ne $taskFile.sha256){throw 'Installed AgentVision mismatch'}
if(Test-Path -LiteralPath (Join-Path $opsDir 'content-plugins.pending.json')){throw 'Plan not consumed'}
Write-Output 'AgentVision deploy: 11 boundary, stopped-service, hash and install checks passed; production untouched'
