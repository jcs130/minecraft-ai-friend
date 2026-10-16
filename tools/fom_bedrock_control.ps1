param(
    [ValidateSet('Start','Stop','Status','Health')][string]$Action='Status',
    [string]$Config='E:\MC\servers\fom-2.42\ops\fom-bedrock.json',
    [string]$Python='E:\MC\runtime\python-3.12.14\python.exe'
)
$ErrorActionPreference='Stop'
$configPath=(Resolve-Path -LiteralPath $Config).Path
$raw=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($raw.mode -ne 'lan') { throw 'Registered control is only for the production LAN bridge' }
$statePath=Join-Path $raw.bridgeDir 'ops\health.json'
$service=Join-Path $PSScriptRoot 'fom_bedrock_service.py'
function Read-FreshState {
    if (-not (Test-Path -LiteralPath $statePath)) { return $null }
    $value=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($value.serverDir -ne $raw.bridgeDir) { throw 'Wrong bridge owner' }
    $age=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()-$value.heartbeatEpoch
    if ($age -lt 0 -or $age -ge 15) { return $null }
    return $value
}
if ($Action -eq 'Health') { & $Python (Join-Path $PSScriptRoot 'fom_bedrock_health.py') --config $configPath; exit $LASTEXITCODE }
if ($Action -eq 'Status') { & $Python $service status --config $configPath; exit $LASTEXITCODE }
if ($Action -eq 'Stop') {
    & $Python $service shutdown --config $configPath
    if ($LASTEXITCODE -ne 0) { throw 'Bridge shutdown request failed' }
    $deadline=[DateTime]::UtcNow.AddSeconds(120)
    do {
        $state=Read-FreshState
        if ($null -ne $state -and $state.shutdownRequested -and @($state.services | Where-Object {$null -ne $_.pid}).Count -eq 0) {
            if (@($state.services | Where-Object {$null -eq $_.lastExit -or $_.lastExit.code -ne 0}).Count -ne 0) { throw 'Owned bridge did not exit normally; inspect logs' }
            @{ok=$true;state='stopped_normally';automaticStartPaused=$true} | ConvertTo-Json
            exit 0
        }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Normal bridge shutdown not confirmed; no force-kill performed'
}
$state=Read-FreshState
if ($null -ne $state -and $state.shutdownRequested) { throw 'Previous owner is still shutting down' }
if ($null -eq $state) {
    & (Join-Path $PSScriptRoot 'maw_service_task.ps1') -Mode Start -FomBedrock -Python $Python -Config $configPath
    if ($LASTEXITCODE -ne 0) { throw 'Registered bridge launch failed' }
    $deadline=[DateTime]::UtcNow.AddSeconds(30)
    do { Start-Sleep -Milliseconds 500; $state=Read-FreshState } while ($null -eq $state -and [DateTime]::UtcNow -lt $deadline)
    if ($null -eq $state) { throw 'Bridge owner did not publish a fresh heartbeat' }
}
if ($state.paused -or $state.stopRequested) {
    & $Python $service resume --config $configPath
    if ($LASTEXITCODE -ne 0) { throw 'Explicit resume failed' }
}
$deadline=[DateTime]::UtcNow.AddSeconds(180)
do {
    $state=Read-FreshState
    if ($null -ne $state -and $state.healthy) { @{ok=$true;udp='192.168.3.163:28988';state='ready'} | ConvertTo-Json; exit 0 }
    if ($null -ne $state -and $state.problem) { throw ('Bridge stopped: '+$state.problem) }
    Start-Sleep -Milliseconds 500
} while ([DateTime]::UtcNow -lt $deadline)
throw 'Bridge readiness timeout; inspect owned logs, no force kill performed'
