$ErrorActionPreference='Stop'
$taskText=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../manage-server.ps1') -Raw -Encoding UTF8
$taskStart=$taskText.IndexOf('function CompleteSnapshots(')
$taskEnd=$taskText.IndexOf('function Assert-MirrorHashes(',$taskStart)
Invoke-Expression $taskText.Substring($taskStart,$taskEnd-$taskStart)
$taskRoot=Join-Path 'E:\MC\ops\repairs\basic-survival-release-20261028' ('retention-fixture-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskRoot | Out-Null
foreach($taskIndex in 1..16){$taskFolder=Join-Path $taskRoot ('20260101-0100{0:d2}' -f $taskIndex);New-Item -ItemType Directory -Path $taskFolder | Out-Null;New-Item -ItemType File -Path (Join-Path $taskFolder '.complete') | Out-Null}
$script:taskWarnings=@();$script:taskDeletes=0
function Log([string]$text){$script:taskWarnings+=$text}
function Remove-Item([string]$LiteralPath,[switch]$Recurse,[switch]$Force,[string]$ErrorAction){
 if(-not $LiteralPath.StartsWith(('\\?\'+$taskRoot+'\'))){throw 'Unsafe test deletion path'}
 $script:taskDeletes++
 throw [IO.DirectoryNotFoundException]::new('Simulated long client dependency path')
}
PruneSnapshots $taskRoot
if($script:taskDeletes -ne 2 -or $script:taskWarnings.Count -ne 2){throw 'Retention failure was not handled'}
if(@(CompleteSnapshots $taskRoot).Count -ne 14){throw 'Incomplete removal still advertises a complete snapshot'}
if(@(Get-ChildItem -LiteralPath $taskRoot -Directory).Count -ne 16){throw 'Mock deleted a directory'}
if(@(Get-ChildItem -LiteralPath $taskRoot -Recurse -Force -Filter '.pruning').Count -ne 2){throw 'Missing incomplete markers'}
'Backup retention failure: 4 checks passed; production untouched'
