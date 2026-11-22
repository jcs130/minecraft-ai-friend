$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Watch-HostedCortico.ps1') -Library
Remove-Variable -Name Config

$temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$work = Join-Path $temp ('cortico-watchdog-test-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $work

function Expect($Actual, $Expected) {
    if ($Actual -cne $Expected) { throw "Expected [$Expected], got [$Actual]" }
}
function Put($File, $Value) { $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $File -Encoding UTF8 }
function Get-CimInstance($ClassName, $Filter) {
    if ($script:cliPresent -and $Filter -ceq "Name='node.exe'") { $fixtureCli }
    if ($Filter -ceq 'ProcessId=202') { $fixtureWorker }
}
function Get-NetTCPConnection($State) {
    if ($script:socket -eq 'owned') {
        [pscustomobject]@{ LocalPort=17788; LocalAddress='127.0.0.1'; OwningProcess=202 }
    } elseif ($script:socket -eq 'foreign') {
        [pscustomobject]@{ LocalPort=17788; LocalAddress='0.0.0.0'; OwningProcess=202 }
    }
}
function Invoke-RestMethod($Uri, $TimeoutSec, $MaximumRedirection) {
    Expect $Uri 'http://127.0.0.1:17788/api/worlds'
    if (!$script:healthyWorld) { throw 'mock endpoint unavailable' }
    [pscustomobject]@{ worlds=@([pscustomobject]@{ id='mymc'; status='active'
        lamps=@([pscustomobject]@{ label='Numen'; state=$script:worldLamp }) }) }
}
function Get-ScheduledTask($TaskName) { [pscustomobject]@{ State='Ready' } }
function Start-ScheduledTask($TaskName) {
    Expect $TaskName 'Test-Kirito'
    $script:starts++
}

try {
    $config = [pscustomobject]@{ root=$work; residentRoot=$work; repo=(Join-Path $work 'Cortico')
        node=(Join-Path $work 'node.exe'); port=17788; deployment='kirito'; role='kirito'
        world='mymc'; launchTask='Test-Kirito' }
    $null = New-Item -ItemType Directory -Path "$work/npc","$work/supervisor"
    $marker = Join-Path $work 'kirito.cortico.handoff.json'
    $status = Join-Path $work 'watchdog.json'
    $meta = @{name='Kirito'; bodyId='test-body'; ownerId='test-owner'; serverId='test-server'
        endpoint='http://127.0.0.1:9999/mcp'; tokenFile=(Join-Path $work 'fixture-token') }
    Put "$work/seat.json" $meta
    Put "$work/roles.json" @{roles=@(@{ id='kirito'; body_kind='numen'; body_id='test-body'; owner_id='test-owner' })}
    Put "$work/npc.json" @{serverId='test-server'; bodies=@{ kirito=@{ name=$meta.name; endpoint=$meta.endpoint
        tokenFile=$meta.tokenFile; externalHandoffFile=$marker } }}
    Put "$work/supervisor/supervisor.json" @{ time=[datetimeoffset]::UtcNow.ToUnixTimeSeconds()
        gameAvailable=$true; maintenance=$false; children=@{npc=@{running=$true}} }
    $snapshot = @{pausing=$false; roles=@(@{id='kirito'; bodyId='test-body'; unknownRequests=0
        health=@{connected=$false} })}
    Put "$work/npc/health.json" $snapshot

    $began = (Get-Date).AddMinutes(-7)
    Put "$work/status.json" @{ pid=790; corticoPid=201; phase='online'; at=$began.AddSeconds(28).ToString('o') }
    $fixtureCli = [pscustomobject]@{ ProcessId=201; ParentProcessId=790; SessionId=3
        CreationDate=$began; ExecutablePath=$config.node; CommandLine=('"' + $config.node + '" bin/cortico.mjs kirito ') }
    $fixtureWorker = [pscustomobject]@{ ProcessId=202; ParentProcessId=201; SessionId=3
        CreationDate=$began.AddSeconds(10); ExecutablePath=$config.node
        CommandLine=('"' + $config.node + '" --import tsx "' + (Join-Path $config.repo 'src/launcher.ts') + '" kirito') }
    $script:cliPresent=$true; $script:socket='owned'; $script:healthyWorld=$true; $script:starts=0
    $script:worldLamp='online'

    Put $marker @{bodyId='test-body'; ownerId='test-owner'; until=[datetimeoffset]::UtcNow.ToUnixTimeSeconds()-120}
    $null = Invoke-RecoveryTick $config
    Expect (Read-Json $status).state 'adopted'
    Expect (Read-Json $marker).processId 201
    Expect (Read-Json $marker).controller 'hosted-cortico-watchdog/v1'
    Expect $script:starts 0

    $prior = [IO.File]::ReadAllText($marker)
    $script:healthyWorld=$false
    $null = Invoke-RecoveryTick $config
    Expect (Read-Json $status).state 'waiting_for_world'
    Expect ([IO.File]::ReadAllText($marker)) $prior
    $script:healthyWorld=$true
    $null = Invoke-RecoveryTick $config
    Expect (Read-Json $status).state 'adopted'

    $fixtureWorker.ParentProcessId=999
    $null = Invoke-RecoveryTick $config
    Expect (Read-Json $status).state 'unverified_process'
    Expect $script:starts 0
    $fixtureWorker.ParentProcessId=201

    $expiredOwn = Read-Json $marker
    $expiredOwn.until = [datetimeoffset]::UtcNow.ToUnixTimeSeconds()-10
    Put $marker $expiredOwn
    $snapshot.roles[0].health.connected=$true
    Put "$work/npc/health.json" $snapshot
    $null = Invoke-RecoveryTick $config
    Expect (Read-Json $status).state 'waiting_for_native_release'
    Expect (Read-Json $marker).until $expiredOwn.until
    $script:worldLamp='loading'
    $expiredOther = @{bodyId='test-body'; ownerId='test-owner'; until=$expiredOwn.until; controller='other'}
    Put $marker $expiredOther
    $null = Invoke-RecoveryTick $config
    Expect (Read-Json $status).state 'waiting_for_native_release'
    Expect (Read-Json $marker).controller 'other'
    Put $marker $expiredOwn
    $snapshot.roles[0].unknownRequests=1
    Put "$work/npc/health.json" $snapshot
    $null = Invoke-RecoveryTick $config
    Expect (Read-Json $status).state 'waiting_for_original_receipt'
    Expect (Read-Json $marker).until $expiredOwn.until
    $snapshot.roles[0].unknownRequests=0
    Put "$work/npc/health.json" $snapshot
    $null = Invoke-RecoveryTick $config
    Expect (Read-Json $status).state 'native_release_requested'
    $renewed = Read-Json $marker
    Expect ($renewed.until -gt [datetimeoffset]::UtcNow.ToUnixTimeSeconds()) $true
    Expect $renewed.processId 201
    $null = Invoke-RecoveryTick $config
    Expect (Read-Json $status).state 'waiting_for_native_release'
    Expect (Read-Json $marker).until $renewed.until
    Expect $script:starts 0
    $snapshot.roles[0].health.connected=$false
    Put "$work/npc/health.json" $snapshot
    $null = Invoke-RecoveryTick $config
    Expect (Read-Json $status).state 'adopted'

    $freshOther=@{bodyId='test-body'; ownerId='test-owner'; until=[datetimeoffset]::UtcNow.ToUnixTimeSeconds()+85}
    Put $marker $freshOther
    $null = Invoke-RecoveryTick $config
    Expect (Read-Json $status).state 'waiting_for_existing_handoff'
    Expect (Read-Json $marker).until $freshOther.until

    Put $marker @{bodyId='test-body'; ownerId='test-owner'; until=[datetimeoffset]::UtcNow.ToUnixTimeSeconds()-120}
    $null = Invoke-RecoveryTick $config
    $script:cliPresent=$false; $script:socket='absent'
    $snapshot.roles[0].unknownRequests=1
    Put "$work/npc/health.json" $snapshot
    $null = Invoke-RecoveryTick $config
    Expect (Read-Json $status).state 'waiting_for_original_receipt'
    Expect $script:starts 0
    $snapshot.roles[0].unknownRequests=0
    Put "$work/npc/health.json" $snapshot
    $null = Invoke-RecoveryTick $config
    Expect (Read-Json $status).state 'launcher_requested'
    Expect $script:starts 1
    Expect (Test-Path -LiteralPath $marker) $false

    $null = New-Item -ItemType File -Path "$work/stop"
    $null = Invoke-RecoveryTick $config
    Expect (Read-Json $status).state 'operator_paused'
    Expect $script:starts 1
    'Hosted Cortico watchdog: adoption, health, process/lease identity, safe restart and operator pause passed.'
} finally {
    $resolved = [IO.Path]::GetFullPath($work)
    if ([IO.Path]::GetDirectoryName($resolved) -ieq $temp.TrimEnd('\','/') -and
        [IO.Path]::GetFileName($resolved) -match '^cortico-watchdog-test-[0-9a-f]{32}$') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
