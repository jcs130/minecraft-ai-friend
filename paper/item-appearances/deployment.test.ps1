param([Parameter(Mandatory=$true)][string]$EvidenceRoot)
$ErrorActionPreference='Stop'
$testRoot=[IO.Path]::GetFullPath($EvidenceRoot)
if (-not $testRoot.StartsWith('E:\MC\ops\repairs\',[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $testRoot)) { throw 'Use a NEW private repairs directory' }
New-Item -ItemType Directory -Path $testRoot | Out-Null
. (Join-Path $PSScriptRoot '../ops/content-deploy.ps1')
function Listener { return $script:runningFixture }
function Log([string]$value) { Add-Content -LiteralPath (Join-Path $testRoot 'events.log') -Value $value }
function Check([bool]$ok,[string]$name) { if(-not $ok){throw $name}; Write-Output "PASS $name" }
$script:runningFixture=$false
$targets=@('plugins/Geyser-Spigot/packs/qiandengji-items-bedrock.mcpack','plugins/Geyser-Spigot/custom_mappings/qiandengji-items.geyser.json')
foreach($scenario in @('new','replace','running','wrong-hash','wrong-before','other-pack','traversal')) {
    $opsDir=Join-Path $testRoot "$scenario/ops"; $serverDir=Join-Path $testRoot "$scenario/server"
    New-Item -ItemType Directory -Path $opsDir,$serverDir,(Join-Path $opsDir 'repairs') -Force | Out-Null
    $source=Join-Path $testRoot "$scenario.source"; [IO.File]::WriteAllText($source,"fixture-$scenario")
    $hash=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $files=@(); $expected=@{}
    foreach($target in $targets) {
        $entry=@{target=$target;source=$source;sha256=$hash}
        if($scenario -in @('replace','wrong-before')) {
            $dest=Join-Path $serverDir $target; New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
            [IO.File]::WriteAllText($dest,'old fixture');$entry.beforeSha256=(Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
        }
        $files+=$entry
    }
    if($scenario -eq 'wrong-hash'){$files[0].sha256=('0'*64)}
    if($scenario -eq 'wrong-before'){$files[0].beforeSha256=('0'*64)}
    if($scenario -eq 'other-pack'){$files[0].target='plugins/Geyser-Spigot/packs/arbitrary.mcpack'}
    if($scenario -eq 'traversal'){$files[0].target='plugins/Geyser-Spigot/packs/../config.yml'}
    $plan=@{schema=1;id="itemart-$scenario";files=$files;removeJars=@()}
    $plan | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $opsDir 'content-plugins.pending.json') -Encoding UTF8
    $script:runningFixture=$scenario -eq 'running';$failure=$null
    try {Deploy-PendingContent} catch {$failure=$_.Exception.Message}
    if($scenario -in @('new','replace')) {
        Check ($null -eq $failure) "$scenario deployment completed"
        foreach($target in $targets){Check ((Get-FileHash -LiteralPath (Join-Path $serverDir $target) -Algorithm SHA256).Hash -eq $hash) "$scenario exact target bytes"}
        $journal=Get-Content -LiteralPath (Join-Path $opsDir "repairs/itemart-$scenario/deployment-rollback/applied.json") -Raw | ConvertFrom-Json
        Check (@($journal).Count -eq 2 -and @($journal|Where-Object{-not $_.Target -or -not $_.Backup}).Count -eq 0) "$scenario recovery journal has actual paths"
        if($scenario -eq 'replace'){foreach($row in $journal){Check ([IO.File]::ReadAllText($row.Backup) -eq 'old fixture') 'original pack preserved for rollback'}}
    } else {
        Check ($null -ne $failure) "$scenario deployment rejected"
        Check (-not (Test-Path -LiteralPath (Join-Path $opsDir "repairs/itemart-$scenario/deployment-rollback"))) "$scenario rejected before mutation"
    }
}
Write-Output 'All 20 deployment checks passed; production was not referenced.'
