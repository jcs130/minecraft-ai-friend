$ErrorActionPreference='Stop'
$taskText=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../manage-server.ps1') -Raw -Encoding UTF8
$taskStart=$taskText.IndexOf('function CompleteSnapshots(')
$taskEnd=$taskText.IndexOf('function Assert-MirrorHashes(',$taskStart)
$taskFunctions=$taskText.Substring($taskStart,$taskEnd-$taskStart)
Invoke-Expression $taskFunctions
$script:taskCount=0
function Check([bool]$condition,[string]$message){if(-not $condition){throw $message};$script:taskCount++}
$script:taskMessages=@()
function Log([string]$message){$script:taskMessages+=$message}
function Listener { return $true }
function CompleteSnapshots([string]$path){throw 'An online native backup root must not even be enumerated.'}
PruneSnapshots 'E:\MC\backups\scheduled'
Check ($script:taskMessages.Count -eq 1) 'Online E: pruning was not deferred'
PruneSnapshots 'F:\MC-backups\scheduled'
Check ($script:taskMessages.Count -eq 2) 'Online F: pruning was not deferred'
Check (@($script:taskMessages | Where-Object {$_ -notlike '*deferred until Paper is stopped*'}).Count -eq 0) 'Missing clear deferral receipt'

# Restore native selection, then exercise only a private fixture. Actual
# removal is mocked so a failure leaves the explicit interrupted marker.
Invoke-Expression $taskFunctions
$taskRoot=Join-Path 'E:\MC\ops\repairs' ('retention-offline-fixture-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskRoot | Out-Null
$taskFixtures=@{
 '20261029-010000'=@('.complete');'20261028-230739'=@('.complete');'20261028-152444'=@('.complete');
 '20261015-030000'=@('.complete');'20261018-030000'=@('.pruning');
 '20261019-030000'=@('.pruning','.keep');'20261020-030000'=@('.pruning','.pinned');
 '20261017-030000'=@();'not-a-snapshot'=@('.pruning')
}
foreach($taskName in $taskFixtures.Keys){
 $taskFolder=Join-Path $taskRoot $taskName;New-Item -ItemType Directory -Path $taskFolder | Out-Null
 foreach($taskMarker in $taskFixtures[$taskName]){New-Item -ItemType File -Path (Join-Path $taskFolder $taskMarker) | Out-Null}
}
$script:taskRemovals=@()
function Remove-Item([string]$LiteralPath,[switch]$Recurse,[switch]$Force,[string]$ErrorAction){
 if(-not $LiteralPath.StartsWith(('\\?\'+$taskRoot+'\'))){throw 'Fixture escaped its exact root'}
 $script:taskRemovals+=$LiteralPath
 throw [IO.IOException]::new('Simulated interrupted cleanup; no files removed')
}
PruneSnapshots $taskRoot ([datetime]'2026-10-29T01:00:00')
Check ($script:taskRemovals.Count -eq 2) 'Expected only one expired snapshot and one interrupted prune'
Check ($script:taskRemovals -contains ('\\?\'+(Join-Path $taskRoot '20261018-030000'))) 'Interrupted native prune was not resumed'
Check (Test-Path -LiteralPath (Join-Path $taskRoot '20261015-030000/.pruning')) 'Expired backup still advertised as complete'
Check (@(CompleteSnapshots $taskRoot).Count -eq 3) 'Newest three complete recovery points changed'
Check (@(Get-ChildItem -LiteralPath $taskRoot -Directory).Count -eq 9) 'Fixture removal should be fully mocked'

$taskTokens=$null;$taskErrors=$null
$taskAst=[System.Management.Automation.Language.Parser]::ParseInput($taskText,[ref]$taskTokens,[ref]$taskErrors)
Check ($taskErrors.Count -eq 0) 'Maintenance script does not parse'
$taskBackup=$taskAst.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Backup-Server'},$true)
$taskMainTry=@($taskBackup.Body.EndBlock.Statements | Where-Object {$_ -is [System.Management.Automation.Language.TryStatementAst]})[-1]
$taskPrunes=@($taskBackup.FindAll({param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'PruneSnapshots'},$true))
Check ($taskPrunes.Count -eq 1 -and $taskPrunes[0].Extent.StartOffset -gt $taskMainTry.Body.Extent.StartOffset -and $taskPrunes[0].Extent.EndOffset -lt $taskMainTry.Body.Extent.EndOffset) 'E: cleanup must finish before finally restarts Paper'
"Offline backup retention: $script:taskCount checks passed; production untouched"
