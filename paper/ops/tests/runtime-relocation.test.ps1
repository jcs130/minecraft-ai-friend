$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../runtime-relocation.ps1')
$script:taskChecks=0
function Check([bool]$condition,[string]$message){if(-not $condition){throw $message};$script:taskChecks++}
function Reject([scriptblock]$operation,[string]$message){$bad=$false;try{&$operation|Out-Null}catch{$bad=$true};Check $bad $message}
$taskPlan=@{schemaVersion=1;releaseId='nvme-runtime-20261029';minimumFreeGiB=80;requestedAt=[datetimeoffset]::Now.ToString('o');moves=@(Relocation-ExpectedMoves)}
Check ((Relocation-ValidatePlan $taskPlan).releaseId -eq 'nvme-runtime-20261029') 'Valid reviewed plan rejected'
foreach($taskCase in @(
 @{field='schemaVersion';value=2},@{field='releaseId';value='arbitrary'},@{field='minimumFreeGiB';value=0},
 @{field='requestedAt';value=[datetimeoffset]::Now.AddHours(-13).ToString('o')},
 @{field='requestedAt';value=[datetimeoffset]::Now.AddHours(1).ToString('o')}
)){
 $taskBad=$taskPlan | ConvertTo-Json -Depth 5 | ConvertFrom-Json;$taskBad.($taskCase.field)=$taskCase.value
 Reject {Relocation-ValidatePlan $taskBad} ('Accepted bad '+$taskCase.field)
}
foreach($taskField in @('source','target','retained','backup')){
 $taskBad=$taskPlan | ConvertTo-Json -Depth 5 | ConvertFrom-Json;$taskBad.moves[0].$taskField='C:\unreviewed'
 Reject {Relocation-ValidatePlan $taskBad} ('Accepted unreviewed '+$taskField)
}
$taskBad=$taskPlan | ConvertTo-Json -Depth 5 | ConvertFrom-Json;$taskBad.moves=@($taskBad.moves[1],$taskBad.moves[0])
Reject {Relocation-ValidatePlan $taskBad} 'Accepted reversed source mappings'
$taskBad=$taskPlan | ConvertTo-Json -Depth 5 | ConvertFrom-Json;$taskBad.moves=@($taskBad.moves[0])
Reject {Relocation-ValidatePlan $taskBad} 'Accepted incomplete mapping'

$taskRoot=Join-Path 'E:\MC\ops\repairs' ('nvme-fixture-'+[guid]::NewGuid().ToString('N'))
$taskSource=Join-Path $taskRoot 'source';$taskCopy=Join-Path $taskRoot 'copy'
New-Item -ItemType Directory -Path (Join-Path $taskSource 'nested'),(Join-Path $taskCopy 'nested') | Out-Null
[IO.File]::WriteAllText((Join-Path $taskSource 'nested/a.txt'),'synthetic-runtime-data')
[IO.File]::WriteAllText((Join-Path $taskSource 'empty.txt'),'')
[IO.File]::WriteAllText((Join-Path $taskCopy 'nested/a.txt'),'synthetic-runtime-data')
[IO.File]::WriteAllText((Join-Path $taskCopy 'empty.txt'),'')
$taskBefore=@(Relocation-Tree $taskSource);$taskAfter=@(Relocation-Tree $taskCopy)
Check ($taskBefore.Count -eq 2 -and $taskBefore[0].path -eq 'empty.txt') 'Manifest paths/count incorrect'
Relocation-Compare $taskBefore $taskAfter;Check $true 'Identical manifest failed'
[IO.File]::WriteAllText((Join-Path $taskCopy 'nested/a.txt'),'synthetic-runtime-edit')
Reject {Relocation-Compare $taskBefore @(Relocation-Tree $taskCopy)} 'Did not detect changed runtime content'
[IO.File]::WriteAllText((Join-Path $taskCopy 'extra.txt'),'extra')
Reject {Relocation-Compare $taskBefore @(Relocation-Tree $taskCopy)} 'Did not detect additional runtime file'

$taskDatabase=Join-Path $taskSource 'test.db'
[IO.File]::WriteAllBytes($taskDatabase,[Text.Encoding]::ASCII.GetBytes("SQLite format 3`0fixture"))
$taskPersistent=@(Relocation-Tree $taskSource)
[IO.File]::WriteAllText(($taskDatabase+'-shm'),'derived coordination cache')
[IO.File]::WriteAllBytes(($taskDatabase+'-wal'),[byte[]]@())
Relocation-Compare $taskPersistent @(Relocation-Tree $taskSource);Check $true 'Read-only SQLite sidecars changed persistent manifest'
[IO.File]::WriteAllText(($taskDatabase+'-wal'),'committed page frames must be retained')
Check (@(Relocation-Tree $taskSource | Where-Object path -eq 'test.db-wal').Count -eq 1) 'Nonempty WAL must remain in the backup'
[IO.File]::WriteAllText(($taskDatabase+'-wal'),'changed page frames')
Check ((Get-FileHash -LiteralPath ($taskDatabase+'-wal')).Hash -eq (@(Relocation-Tree $taskSource | Where-Object path -eq 'test.db-wal')[0].sha256)) 'WAL contents must be hashed'
[IO.File]::WriteAllText((Join-Path $taskSource 'notes-shm'),'ordinary file')
[IO.File]::WriteAllText((Join-Path $taskSource 'notes'),'not a SQLite database')
Check (@(Relocation-Tree $taskSource | Where-Object path -eq 'notes-shm').Count -eq 1) 'Ordinary shm-named files must not be discarded'
[IO.File]::WriteAllText((Join-Path $taskSource 'orphan-wal'),'')
Check (@(Relocation-Tree $taskSource | Where-Object path -eq 'orphan-wal').Count -eq 1) 'Orphan WAL must remain data'

# A same-volume move retains inherited ACEs from its former private parent.
# Restoring inheritance under a different root must not broaden this file.
$taskRestricted=Join-Path $taskRoot 'restricted'
Relocation-NewPrivateTarget $taskRestricted
$taskImported=Join-Path $taskRestricted 'imported.txt'
[IO.File]::WriteAllText($taskImported,'synthetic-private-access')
$taskSourceBroad=Get-Acl -LiteralPath $taskSource
$taskSourceBroad.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),'ReadAndExecute','ContainerInherit, ObjectInherit','None','Allow'))
Set-Acl -LiteralPath $taskSource -AclObject $taskSourceBroad
$taskRelocated=Join-Path $taskSource 'nested/imported.txt'
if(-not $taskImported.StartsWith($taskRoot+'\') -or -not $taskRelocated.StartsWith($taskRoot+'\')){throw 'Fixture move escaped its root'}
[IO.File]::Move($taskImported,$taskRelocated)
$taskAccessTarget=Join-Path $taskCopy 'nested/imported.txt'
$taskBroadAcl=Get-Acl -LiteralPath $taskCopy
$taskReader=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')
$taskBroadAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($taskReader,'ReadAndExecute','ContainerInherit, ObjectInherit','None','Allow'))
Set-Acl -LiteralPath $taskCopy -AclObject $taskBroadAcl
[IO.File]::WriteAllText($taskAccessTarget,'synthetic-private-access')
Check (@((Get-Acl -LiteralPath $taskRelocated).Access | Where-Object IsInherited).Count -gt 0) 'Fixture lost its inherited original entries'
Check (@(Compare-Object @(Relocation-Access $taskRelocated) @(Relocation-Access $taskAccessTarget)).Count -gt 0) 'Fixture did not reproduce differing inherited access'
Relocation-CopyAccess $taskRelocated $taskAccessTarget
Check (@(Compare-Object @(Relocation-Access $taskRelocated) @(Relocation-Access $taskAccessTarget)).Count -eq 0) 'Imported file access was not preserved'
Check (Get-Acl -LiteralPath $taskAccessTarget).AreAccessRulesProtected 'Copied file may inherit broader parent access'
Relocation-CopyAccess $taskCopy (Join-Path $taskCopy 'nested')
Relocation-CopyAccess $taskSource $taskCopy
Check (@(Compare-Object @(Relocation-Access $taskRelocated) @(Relocation-Access $taskAccessTarget)).Count -eq 0) 'Parent access update broadened a copied child'
Reject {Relocation-CopyAccess $taskRelocated (Join-Path $taskCopy 'nested')} 'Accepted mismatched access item types'

# A real WorldGuard file had both explicit and inherited Administrators FA.
# Freezing inheritance coalesces those identical ACEs. Multiplicity changes
# the representation, not the permitted identities, rights or propagation.
$taskDuplicate=Join-Path $taskSource 'duplicate-access.txt'
$taskDuplicateCopy=Join-Path $taskCopy 'duplicate-access.txt'
[IO.File]::WriteAllText($taskDuplicate,'synthetic duplicate permission')
[IO.File]::WriteAllText($taskDuplicateCopy,'synthetic duplicate permission')
$taskAdmin=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$taskDupAcl=Get-Acl -LiteralPath $taskDuplicate
$taskDupAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($taskAdmin,'FullControl','Allow'))
Set-Acl -LiteralPath $taskDuplicate -AclObject $taskDupAcl
$taskAdminRules=@((Get-Acl -LiteralPath $taskDuplicate).GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object {$_.IdentityReference -eq $taskAdmin -and $_.FileSystemRights -eq 'FullControl'})
Check ($taskAdminRules.Count -ge 2) 'Fixture did not reproduce inherited and explicit duplicate ACEs'
Relocation-CopyAccess $taskDuplicate $taskDuplicateCopy
Check (@(Compare-Object @(Relocation-Access $taskDuplicate) @(Relocation-Access $taskDuplicateCopy)).Count -eq 0) 'Redundant ACE normalization changed effective permissions'
Check (Get-Acl -LiteralPath $taskDuplicateCopy).AreAccessRulesProtected 'Duplicate-ACE copy must remain protected'
$taskGuests=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-546')
$taskAccessOnly=[Security.AccessControl.AccessControlSections]::Access
foreach($taskVariant in @(@{name='extra-allow.txt';rights='Read';kind='Allow'},@{name='extra-deny.txt';rights='Write';kind='Deny'})){
    # Use a new owned file: the sealed copy intentionally no longer inherits
    # the fixture owner's WRITE_DAC, so editing that copy needs elevation.
    $taskVariantPath=Join-Path $taskSource $taskVariant.name
    [IO.File]::WriteAllText($taskVariantPath,'synthetic changed permission')
    $taskChangedAcl=[Security.AccessControl.FileSecurity]::new()
    $taskChangedAcl.SetSecurityDescriptorSddlForm((Get-Acl -LiteralPath $taskDuplicate).GetSecurityDescriptorSddlForm($taskAccessOnly),$taskAccessOnly)
    $taskChangedAcl.SetAccessRuleProtection($true,$true)
    $taskChangedAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($taskGuests,$taskVariant.rights,$taskVariant.kind))
    Set-Acl -LiteralPath $taskVariantPath -AclObject $taskChangedAcl
    Check (@(Compare-Object @(Relocation-Access $taskDuplicate) @(Relocation-Access $taskVariantPath)).Count -gt 0) ('Changed '+$taskVariant.kind+' rights were ignored')
}

$taskText=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../manage-server.ps1') -Raw -Encoding UTF8
Check ($taskText.Contains("'runtime-relocation.pending.json'")) 'One-shot request is not excluded from backups'
Check ($taskText.Contains('Runtime relocation recovery requires inspection; refusing startup')) 'Missing crash recovery startup gate'
$taskRelocation=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../runtime-relocation.ps1') -Raw -Encoding UTF8
Check ($taskRelocation.Contains('[IO.Directory]::Delete($move.source)') -and $taskRelocation -notmatch 'Remove-Item[^\r\n]+-Recurse|Directory\]::Delete\([^\r\n]+,\s*\$true') 'Rollback must remove only the exact junction, never a recursive target'
"Runtime relocation: $script:taskChecks checks passed; no game, junction or account changes"
