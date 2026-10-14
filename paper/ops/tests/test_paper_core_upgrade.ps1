param([Parameter(Mandatory=$true)][string]$PaperJar)
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'paper-core-upgrade.ps1')
if ((Get-FileHash -LiteralPath $PaperJar -Algorithm SHA256).Hash -ne '39BD8C00B9E18DE91DCABD3CC3DCFA5328685A53B7187A2F63280C22E2D287B9') { throw 'Use official Paper 1.21.1 build 133' }
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('paper-core-tests-' + [guid]::NewGuid().ToString('N'))
$sourceRoot = Join-Path $testRoot 'source'
New-Item -ItemType Directory -Path $sourceRoot -Force | Out-Null
Copy-Item -LiteralPath $PaperJar -Destination (Join-Path $sourceRoot 'paper.jar')
New-Item -ItemType Directory -Path (Join-Path $sourceRoot 'operations') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) 'migrate-legacy-item-meta.mjs') -Destination (Join-Path $sourceRoot 'operations/migrate-legacy-item-meta.mjs')
[IO.File]::WriteAllText((Join-Path $sourceRoot 'pack.zip'),'converted pack')
$script:caseNumber=0; $script:passed=0
function New-CoreCase {
    $script:caseNumber++
    $name='case-' + $script:caseNumber
    $caseRoot=Join-Path $testRoot $name; $server=Join-Path $caseRoot 'server'
    New-Item -ItemType Directory -Path (Join-Path $server 'world/datapacks'),(Join-Path $server 'plugins') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $server 'server.jar'),'old paper fixture')
    [IO.File]::WriteAllText((Join-Path $server 'world/level.dat'),'untouched player-world fixture')
    [IO.File]::WriteAllText((Join-Path $server 'world/datapacks/test.zip'),'old pack fixture')
    [IO.File]::WriteAllText((Join-Path $server 'plugins/AgentFriend-0.4.40.jar'),'old plugin fixture')
    New-Item -ItemType Directory -Path (Join-Path $server 'plugins/AgentFriend') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $server 'plugins/AgentFriend/data.json'),'{"progress":"fresh-current-progress","reward":{"==":"org.bukkit.inventory.ItemStack","v":3839,"type":"SHIELD","meta":{"==":"ItemMeta","meta-type":"TILE_ENTITY","blockMaterial":"SHIELD","display-name":"original shield"}}}')
    $snapshots=@(Join-Path $caseRoot 'local'; Join-Path $caseRoot 'mirror')
    foreach($snapshot in $snapshots) {
        New-Item -ItemType Directory -Path $snapshot -Force | Out-Null
        Copy-Item -LiteralPath $server -Destination (Join-Path $snapshot 'server') -Recurse
        [IO.File]::WriteAllText((Join-Path $snapshot '.complete'),'')
        [IO.File]::WriteAllText((Join-Path $snapshot 'backup.json'),'{"stoppedForCopy":true}')
    }
    $oldHash=(Get-FileHash -LiteralPath (Join-Path $server 'server.jar') -Algorithm SHA256).Hash
    $plan=@{schema=1;approved=$true;id=('paper-1-21-1-test-case-' + $script:caseNumber);from='1.20.6';to='1.21.1';paperBuild=133;
        files=@(@{source='paper.jar';target='server.jar';sha256=(Get-FileHash -LiteralPath $PaperJar -Algorithm SHA256).Hash;beforeSha256=$oldHash},
            @{source='pack.zip';target='world/datapacks/test.zip';sha256=(Get-FileHash -LiteralPath (Join-Path $sourceRoot 'pack.zip') -Algorithm SHA256).Hash;beforeSha256=(Get-FileHash -LiteralPath (Join-Path $server 'world/datapacks/test.zip') -Algorithm SHA256).Hash});
        disableJars=@(@{target='plugins/AgentFriend-0.4.40.jar';sha256=(Get-FileHash -LiteralPath (Join-Path $server 'plugins/AgentFriend-0.4.40.jar') -Algorithm SHA256).Hash})}
    return @{Server=$server;Local=$snapshots[0];Mirror=$snapshots[1];Plan=$plan;PlanPath=(Join-Path $caseRoot 'plan.json');OldHash=$oldHash}
}
function Run-CoreCase($case,[bool]$running=$false) {
    $case.Plan | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $case.PlanPath -Encoding UTF8
    Invoke-PaperCoreUpgrade -PlanPath $case.PlanPath -ServerRoot $case.Server -SourceRoot $sourceRoot -LocalSnapshot $case.Local -MirrorSnapshot $case.Mirror -ServerRunning { $running } -YsmRoot $case.Ysm -YsmRunning { [bool]$case.YsmActive }
}
function Assert-Core([bool]$condition,[string]$name) { if(-not $condition){throw $name};$script:passed++;Write-Host "PASS $name" }
function Expect-CoreRejected($case,[string]$name,[bool]$running=$false) {
    $rejected=$false
    try { $null=Run-CoreCase $case $running } catch { $rejected=$true }
    Assert-Core $rejected $name
    Assert-Core ((Get-FileHash -LiteralPath (Join-Path $case.Server 'server.jar') -Algorithm SHA256).Hash -eq $case.OldHash) ($name + ': original server retained')
}
foreach ($status in @('Paper 1.20.6 (proto 766)','Paper 1.21.1 (proto 766)','Paper 1.21.1 (proto 767)')) {
    Assert-Core (Core-SupportedStatus $status) ('maintenance accepts ' + $status)
}
foreach ($status in @('Paper 1.21.4 (proto 769)','Paper 1.20.6 (proto 767)')) {
    Assert-Core (-not (Core-SupportedStatus $status)) ('maintenance rejects ' + $status)
}
$case=New-CoreCase;$receipt=Run-CoreCase $case
Assert-Core ($receipt.Files -eq 3 -and -not $receipt.WorldWritten) 'real pinned JAR and pack installed offline'
Assert-Core ((Get-FileHash -LiteralPath (Join-Path $case.Server 'server.jar') -Algorithm SHA256).Hash -eq $case.Plan.files[0].sha256) 'installed real JAR hash checked'
Assert-Core ((Get-Content -LiteralPath (Join-Path $case.Server 'world/level.dat') -Raw) -eq 'untouched player-world fixture') 'world data never edited by file transaction'
Assert-Core (-not (Test-Path -LiteralPath (Join-Path $case.Server 'plugins/AgentFriend-0.4.40.jar'))) 'old plugin disabled only after all gates'
Assert-Core (-not (Test-Path -LiteralPath $case.PlanPath)) 'successful plan consumed once'
$case=New-CoreCase
$case.Plan.legacyItemMigration=@{source='operations/migrate-legacy-item-meta.mjs';sha256=(Get-FileHash -LiteralPath (Join-Path $sourceRoot 'operations/migrate-legacy-item-meta.mjs') -Algorithm SHA256).Hash}
$receipt=Run-CoreCase $case
$migrated=Get-Content -LiteralPath (Join-Path $case.Server 'plugins/AgentFriend/data.json') -Raw | ConvertFrom-Json
Assert-Core ($receipt.LegacyShields -eq 1 -and $migrated.reward.meta.'meta-type' -eq 'SHIELD') 'fresh stopped plugin data migrates before first new-core start'
Assert-Core ($migrated.progress -eq 'fresh-current-progress' -and $migrated.reward.meta.'display-name' -eq 'original shield') 'migration preserves current progress and reward metadata'
$case=New-CoreCase
$case.Plan.legacyItemMigration=@{source='operations/migrate-legacy-item-meta.mjs';sha256=('0'*64)}
Expect-CoreRejected $case 'unverified dynamic migrator rejected before installation'
$case=New-CoreCase
$case.Plan.files+=@{source='pack.zip';target='ysm-private/proxy/plugins/LoginGuard-0.1.2.jar';sha256=(Get-FileHash -LiteralPath (Join-Path $sourceRoot 'pack.zip') -Algorithm SHA256).Hash}
$case.Ysm=Join-Path $testRoot 'private-ysm-fixture';$case.YsmActive=$true
Expect-CoreRejected $case 'running login/model service rejected before mutation'
$case=New-CoreCase
$case.Plan.files+=@{source='pack.zip';target='ysm-private/proxy/plugins/LoginGuard-0.1.2.jar';sha256=(Get-FileHash -LiteralPath (Join-Path $sourceRoot 'pack.zip') -Algorithm SHA256).Hash}
$case.Ysm=Join-Path $testRoot 'stopped-ysm-fixture';$case.YsmActive=$false
$receipt=Run-CoreCase $case
Assert-Core (Test-Path -LiteralPath (Join-Path $case.Ysm 'proxy/plugins/LoginGuard-0.1.2.jar')) 'stopped login companion included in the same transaction'
$case=New-CoreCase;$case.Plan.approved=$false;Expect-CoreRejected $case 'unapproved plan rejected'
$case=New-CoreCase;Expect-CoreRejected $case 'running server rejected' $true
$case=New-CoreCase;Remove-Item -LiteralPath (Join-Path $case.Mirror '.complete');Expect-CoreRejected $case 'incomplete mirror rejected'
$case=New-CoreCase;$case.Plan.files[1].source='../escape.zip';Expect-CoreRejected $case 'source traversal rejected'
$case=New-CoreCase;$case.Plan.files[1].sha256=('0'*64);Expect-CoreRejected $case 'source digest mismatch rejected before mutation'
$case=New-CoreCase;$case.Plan.files+= $case.Plan.files[0];Expect-CoreRejected $case 'duplicate target rejected'
$case=New-CoreCase;$case.Plan.disableJars[0].sha256=('1'*64);Expect-CoreRejected $case 'old plugin mismatch rejected before mutation'
$case=New-CoreCase
$script:faultDestination=Join-Path $case.Server 'world/datapacks/test.zip'
function Move-Item {
    param([string]$LiteralPath,[string]$Destination,[switch]$Force)
    if($Destination -eq $script:faultDestination -and $LiteralPath.EndsWith('.core-installing')) { throw 'deliberate install I/O failure' }
    Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination -Force:$Force
}
Expect-CoreRejected $case 'partial I/O failure restores old core'
Remove-Item -LiteralPath Function:\Move-Item
Assert-Core ((Get-Content -LiteralPath (Join-Path $case.Server 'world/datapacks/test.zip') -Raw) -eq 'old pack fixture') 'partial transaction restores old pack'
Assert-Core (Test-Path -LiteralPath (Join-Path $case.Server 'plugins/AgentFriend-0.4.40.jar')) 'partial transaction retains original enabled plugin'
$case=New-CoreCase
$script:faultDestination=Join-Path $case.Server 'world/datapacks/test.zip'
$script:failedBackupSource=Join-Path $case.Local 'server/server.jar'
function Move-Item {
    param([string]$LiteralPath,[string]$Destination,[switch]$Force)
    if($Destination -eq $script:faultDestination -and $LiteralPath.EndsWith('.core-installing')) { throw 'deliberate install failure' }
    Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination -Force:$Force
}
function Copy-Item {
    param([string]$LiteralPath,[string]$Destination,[switch]$Force)
    if($LiteralPath -eq $script:failedBackupSource) { throw 'deliberate recovery media failure' }
    Microsoft.PowerShell.Management\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Force:$Force
}
$blocked=$false
try { $null=Run-CoreCase $case } catch { $blocked=[bool]$_.Exception.Data['CoreRecoveryBlocked'] }
Remove-Item -LiteralPath Function:\Move-Item
Remove-Item -LiteralPath Function:\Copy-Item
Assert-Core $blocked 'failed file recovery explicitly blocks automatic startup'
Write-Output ([pscustomobject]@{Passed=$script:passed;EvidenceDirectory=$testRoot;ProductionModified=$false} | ConvertTo-Json)
