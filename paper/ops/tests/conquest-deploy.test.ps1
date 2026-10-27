param([Parameter(Mandatory=$true)][string]$CandidateRoot)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../content-deploy.ps1')
$taskChecks=0
foreach($case in @(
 @('TAB-6.2.1-Paper-1.20.5-1.21.4.jar',$true),
 @('plugins/TAB/config.yml',$true),
 @('TAB.jar',$false),@('TAB-6.2.2-Paper-1.20.5-1.21.4.jar',$false),
 @('plugins/TAB/groups.yml',$false),@('plugins/tab/config.yml',$false),
 @('plugins/TAB/../AgentFriend/config.yml',$false),@('plugins/TAB/config.yml.bak',$false)
)){if((Content-ConquestScoreboardTarget $case[0]) -ne $case[1]){throw 'scoreboard target boundary'};$taskChecks++}
$taskSource=[IO.Path]::GetFullPath($CandidateRoot)
if(-not $taskSource.StartsWith('E:\MC\ops\repairs\',[StringComparison]::OrdinalIgnoreCase)){throw 'isolated repairs root required'}
$taskRoot=Join-Path $taskSource ('conquest-installer-test-'+[guid]::NewGuid().ToString('N'))
$serverDir=Join-Path $taskRoot 'server';$opsDir=Join-Path $taskRoot 'ops'
New-Item -ItemType Directory -Path $serverDir,$opsDir -Force | Out-Null
$script:taskListening=$false
function Listener{return $script:taskListening}
function Log([string]$text){}
$taskInput=Join-Path $taskRoot 'sidebar.yml'
[IO.File]::WriteAllText($taskInput,"scoreboard: {enabled: true}`n",[Text.UTF8Encoding]::new($false))
$taskFile=@{source=$taskInput;target='plugins/TAB/config.yml';sha256=(Get-FileHash -LiteralPath $taskInput).Hash}
function Plan($file,$schema=1){@{schema=$schema;id=('conquest-test-'+[guid]::NewGuid().ToString('N'));files=@($file);removeJars=@()}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $opsDir 'content-plugins.pending.json') -Encoding UTF8}
function Refuse($file,$reason){Plan $file;$failed=$false;try{Deploy-PendingContent}catch{if($_ -notmatch $reason){throw};$failed=$true};if(-not $failed){throw "unsafe plan accepted: $reason"};$script:taskChecks++}
Plan $taskFile 0
$taskRejected=$false;try{Deploy-PendingContent}catch{if($_ -notmatch 'Invalid content deployment plan'){throw};$taskRejected=$true}
if(-not $taskRejected){throw 'review template was deployable'};$taskChecks++
$script:taskListening=$true;Refuse $taskFile 'requires stopped Paper';$script:taskListening=$false
$bad=$taskFile.Clone();$bad.sha256='0'*64;Refuse $bad 'source hash mismatch'
$bad=$taskFile.Clone();$bad.target='plugins/TAB/groups.yml';Refuse $bad 'Unexpected content target'
$bad=$taskFile.Clone();$bad.target='TAB-6.2.2-Paper-1.20.5-1.21.4.jar';Refuse $bad 'Unexpected plugin JAR'
Plan $taskFile;Deploy-PendingContent
$taskTarget=Join-Path $serverDir $taskFile.target
if((Get-FileHash -LiteralPath $taskTarget).Hash -ne $taskFile.sha256){throw 'sidebar installation mismatch'};$taskChecks++
Refuse $taskFile 'unrecorded file'
$bad=$taskFile.Clone();$bad.beforeSha256='0'*64;Refuse $bad 'target changed'
$taskFile.beforeSha256=$taskFile.sha256;Plan $taskFile;Deploy-PendingContent
$taskOriginals=@(Get-ChildItem -LiteralPath (Join-Path $opsDir repairs) -Recurse -Filter '0.original')
if($taskOriginals.Count -ne 1 -or (Get-FileHash -LiteralPath $taskOriginals[0].FullName).Hash -ne $taskFile.beforeSha256){throw 'exact rollback preimage missing'};$taskChecks++
$bad=$taskFile.Clone();$bad.target='TAB-6.2.1-Paper-1.20.5-1.21.4.jar';$bad.Remove('beforeSha256');Plan $bad;Deploy-PendingContent
if((Get-FileHash -LiteralPath (Join-Path $serverDir 'plugins/TAB-6.2.1-Paper-1.20.5-1.21.4.jar')).Hash -ne $bad.sha256){throw 'pinned jar route failed'};$taskChecks++
Write-Output "Conquest installer: $taskChecks checks passed; production untouched"
