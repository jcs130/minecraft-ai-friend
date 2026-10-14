param(
    [ValidateSet('Start','Stop','Status','Health')][string]$Action='Status',
    [string]$Config='E:\MC\servers\fom-2.42\ops\service.json',
    [string]$Python='E:\MC\runtime\python-3.12.14\python.exe'
)
$ErrorActionPreference='Stop'
$configPath=(Resolve-Path -LiteralPath $Config).Path
$settings=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$healthPath=Join-Path $settings.runtimeDir 'health.json'
$service=Join-Path $PSScriptRoot 'fom_service.py'

function Read-OwnedHealth {
    if (-not (Test-Path -LiteralPath $healthPath -PathType Leaf)) { return $null }
    try { $state=Get-Content -LiteralPath $healthPath -Raw | ConvertFrom-Json } catch { return $null }
    if ($state.serverDir -ne $settings.serverDir) { throw 'Health file belongs to a different server' }
    return $state
}
function Is-Fresh($state) {
    if ($null -eq $state) { return $false }
    $age=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()-$state.heartbeatEpoch
    return $age -ge 0 -and $age -lt 15
}
function Invoke-Service([string]$operation) {
    & $Python $service $operation --config $configPath --wait 30
    if ($LASTEXITCODE -ne 0) { throw ('Service command failed: '+$operation) }
}

if ($Action -eq 'Status') { Invoke-Service 'status'; exit 0 }
if ($Action -eq 'Health') {
    & $Python (Join-Path $PSScriptRoot 'fom_health.py') --config $configPath
    exit $LASTEXITCODE
}
if ($Action -eq 'Stop') {
    Invoke-Service 'shutdown'
    $deadline=[DateTime]::UtcNow.AddSeconds(150)
    do {
        $state=Read-OwnedHealth
        if ($null -ne $state -and $state.shutdownRequested -and @($state.services | Where-Object {$null -ne $_.pid}).Count -eq 0) {
            if (@($state.services | Where-Object {$null -eq $_.lastExit -or $_.lastExit.code -ne 0}).Count -ne 0) { throw 'Owned server did not exit normally; inspect logs' }
            @{ok=$true;state='stopped_normally';automaticStartPaused=$true} | ConvertTo-Json
            exit 0
        }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Normal shutdown not confirmed; no force-kill performed'
}

$state=Read-OwnedHealth
if ((Is-Fresh $state) -and $state.shutdownRequested) { throw 'Previous owner is shutting down; wait and run Start again' }
if (-not (Is-Fresh $state)) {
    & (Join-Path $PSScriptRoot 'maw_service_task.ps1') -Mode Start -Fom -Python $Python -Config $configPath
    if ($LASTEXITCODE -ne 0) { throw 'Registered owner launch failed' }
    $deadline=[DateTime]::UtcNow.AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 500
        $state=Read-OwnedHealth
        if ((Is-Fresh $state) -and -not $state.shutdownRequested) { break }
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not (Is-Fresh $state) -or $state.shutdownRequested) { throw 'New owner heartbeat not confirmed' }
}
# Explicit Start is an operator request to leave the previous maintenance pause.
if ($state.paused -or $state.stopRequested) { Invoke-Service 'resume' }
$deadline=[DateTime]::UtcNow.AddSeconds(300)
do {
    $state=Read-OwnedHealth
    if ((Is-Fresh $state) -and $state.healthy) {
        @{ok=$true;state='ready';gamePort=$settings.gamePort;serverDir=$settings.serverDir} | ConvertTo-Json
        exit 0
    }
    if ((Is-Fresh $state) -and $state.paused) { throw ('Server paused: '+$state.problem) }
    Start-Sleep -Milliseconds 500
} while ([DateTime]::UtcNow -lt $deadline)
throw 'Server readiness not confirmed; inspect owned logs'
