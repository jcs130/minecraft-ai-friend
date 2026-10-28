$ErrorActionPreference='Stop'
$taskText=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../manage-server.ps1') -Raw -Encoding UTF8
$taskStart=$taskText.IndexOf('function CompleteSnapshots(')
$taskEnd=$taskText.IndexOf('function Assert-MirrorHashes(',$taskStart)
Invoke-Expression $taskText.Substring($taskStart,$taskEnd-$taskStart)
$taskRoot=Join-Path 'E:\MC\ops\repairs' ('retention-policy-fixture-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskRoot | Out-Null
$taskNames=@('20261028-230739','20261028-152444','20261028-092455','20261028-040412','20261027-220757','20261027-141626','20261025-040015','20261024-040017','20261024-010454','20261023-215753','20261022-223855','20261021-202316','20261021-040021','20260101-010001')
foreach($taskName in $taskNames){$taskFolder=Join-Path $taskRoot $taskName;New-Item -ItemType Directory -Path $taskFolder | Out-Null;New-Item -ItemType File -Path (Join-Path $taskFolder '.complete') | Out-Null}
New-Item -ItemType File -Path (Join-Path $taskRoot '20260101-010001/.keep') | Out-Null
$taskComplete=@(CompleteSnapshots $taskRoot)
$taskKeep=@(RetainedSnapshots $taskComplete ([datetime]'2026-10-28T23:50:00'))
$taskExpected=@('20261028-230739','20261028-152444','20261028-092455','20261027-220757','20261025-040015','20261024-040017','20261023-215753','20261022-223855','20260101-010001')
foreach($taskName in $taskExpected){if($taskKeep -notcontains (Join-Path $taskRoot $taskName)){throw ('Lost expected recovery point '+$taskName)}}
if($taskKeep.Count -ne $taskExpected.Count){throw 'Too many daily backups retained'}
if($taskKeep -contains (Join-Path $taskRoot '20261021-202316')){throw 'Calendar cutoff incorrectly retained an older backup day'}
if($taskKeep -contains (Join-Path $taskRoot '20261027-141626')){throw 'Kept a duplicate older daily snapshot'}
if(@(CompleteSnapshots $taskRoot).Count -ne $taskNames.Count){throw 'Planning must be read-only'}
'Backup retention policy: 13 checks passed; planning only, production untouched'
