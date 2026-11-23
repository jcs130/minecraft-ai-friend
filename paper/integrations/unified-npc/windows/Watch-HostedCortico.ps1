param([string]$Config, [switch]$Library)
$ErrorActionPreference = 'Stop'

function Read-Json([string]$Path) {
    Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Test-CorticoCli($Process, [string]$Node, [string]$Deployment) {
    if (!$Process -or $Process.ExecutablePath -ine $Node) { return $false }
    $arg = [regex]::Escape($Deployment)
    return $Process.CommandLine -cmatch ('^\s*(?:"[^"]+"|\S+)\s+(?:"bin[/\\]cortico\.mjs"|bin[/\\]cortico\.mjs)\s+' + $arg + '\s*$')
}

function Test-CorticoListener($Worker, $Cli, [string]$Node, [string]$Repo, [string]$Deployment) {
    if (!$Worker -or !$Cli -or $Worker.ExecutablePath -ine $Node -or
        $Worker.ParentProcessId -ne $Cli.ProcessId -or $Worker.SessionId -ne $Cli.SessionId -or
        [datetime]$Worker.CreationDate -lt [datetime]$Cli.CreationDate) { return $false }
    $entry = [regex]::Escape([IO.Path]::GetFullPath((Join-Path $Repo 'src/launcher.ts')))
    $arg = [regex]::Escape($Deployment)
    return $Worker.CommandLine -imatch ('^\s*(?:"[^"]+"|\S+)\s+--import\s+tsx\s+(?:"' + $entry + '"|' + $entry + ')\s+' + $arg + '\s*$')
}

function Test-RecordedCortico($Cli, $Launch) {
    if (!$Cli -or !$Launch -or $Launch.phase -cnotin @('starting', 'online') -or
        $Cli.ProcessId -ne $Launch.corticoPid -or $Cli.ParentProcessId -ne $Launch.pid) { return $false }
    $age = ([datetimeoffset]$Launch.at - [datetimeoffset]$Cli.CreationDate).TotalSeconds
    return $age -ge 0 -and $age -le 180
}

function Get-RecoveryDecision($State) {
    if ($State.Stopped) { return 'operator_paused' }
    if (!$State.GameReady -or !$State.RoleReady) { return 'waiting_for_game_or_role' }
    if ($State.Unknown -ne 0) { return 'waiting_for_original_receipt' }
    if ($State.CliCount -gt 1 -or $State.Listener -eq 'foreign') { return 'unverified_process' }
    if ($State.CliCount -eq 1) {
        if (!$State.CliVerified) { return 'unverified_process' }
        if ($State.Listener -ne 'owned' -or !$State.WorldActive) { return 'waiting_for_world' }
        if ($State.NativeConnected) { return 'waiting_for_native_release' }
        if ($State.Marker -eq 'foreign') { return 'waiting_for_existing_handoff' }
        return 'adopted'
    }
    if ($State.Listener -ne 'absent') { return 'unverified_process' }
    if ($State.Marker -eq 'foreign') { return 'waiting_for_existing_handoff' }
    if (!$State.NativeConnected -and !$State.NativeAvailable -and !$State.PreviousAdoption) {
        return 'waiting_for_native_release'
    }
    return 'request_launcher'
}

function Write-Atomic([string]$Path, [string]$Text, $Prior) {
    $tmp = "$Path.$PID.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        [IO.File]::WriteAllText($tmp, $Text)
        if ($null -eq $Prior) {
            [IO.File]::Move($tmp, $Path)
        } else {
            if ([IO.File]::ReadAllText($Path) -cne $Prior) { throw 'Coordination file changed' }
            [IO.File]::Replace($tmp, $Path, [NullString]::Value)
        }
    } finally { if ([IO.File]::Exists($tmp)) { [IO.File]::Delete($tmp) } }
}

function Write-WatchStatus($Config, [string]$State, $PidRecord, $Lease, $Failure) {
    $path = Join-Path $Config.root 'watchdog.json'
    $old = if ([IO.File]::Exists($path)) { [IO.File]::ReadAllText($path) }
    $text = [ordered]@{ state=$State; checkedAt=(Get-Date -Format o); corticoPid=$PidRecord
        expiresAt=$Lease; error=$Failure } | ConvertTo-Json -Compress
    Write-Atomic $path $text $old
    Write-Output $text
}

function Invoke-RecoveryTick($Cfg) {
    foreach ($key in @('root','residentRoot','repo','node')) {
        if (!$Cfg.$key -or ![IO.Path]::IsPathRooted($Cfg.$key)) { throw 'Absolute configuration paths required' }
    }
    if ($Cfg.deployment -cnotmatch '^[a-z0-9][a-z0-9_-]{0,31}$' -or $Cfg.role -cnotmatch '^[a-z0-9][a-z0-9_-]{0,31}$' -or
        !$Cfg.launchTask -or $Cfg.world -cnotmatch '^[a-z0-9_-]{1,32}$' -or
        [int]$Cfg.port -lt 1024 -or [int]$Cfg.port -gt 65535) { throw 'Invalid hosted recovery configuration' }
    $stop = Join-Path $Cfg.root 'stop'
    $reportPath = Join-Path $Cfg.root 'status.json'
    $roleHealth = Join-Path $Cfg.residentRoot 'npc/health.json'
    $coordination = Join-Path $Cfg.residentRoot 'supervisor/supervisor.json'
    $restartRequested = $false
    $now = [datetimeoffset]::UtcNow
    try {
        $lock = [IO.File]::Open((Join-Path $Cfg.root 'controller.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    } catch [IO.IOException] {
        if (($_.Exception.HResult -band 0xffff) -notin @(32,33)) { throw }
        Write-WatchStatus $Cfg 'managed_launcher' $null $null $null
        return
    }
    try {
        if ((Test-Path -LiteralPath $stop) -or (Test-Path -LiteralPath (Join-Path $Cfg.residentRoot 'maintenance.pause'))) {
            Write-WatchStatus $Cfg 'operator_paused' $null $null $null
            return
        }
        $seat = Read-Json (Join-Path $Cfg.root 'seat.json')
        $resident = Read-Json (Join-Path $Cfg.residentRoot 'npc.json')
        $roster = @( (Read-Json (Join-Path $Cfg.residentRoot 'roles.json')).roles | Where-Object id -ceq $Cfg.role )
        $spec = $resident.bodies.PSObject.Properties[$Cfg.role].Value
        $marker = Join-Path $Cfg.residentRoot ($Cfg.role + '.cortico.handoff.json')
        if ($roster.Count -ne 1 -or $roster[0].body_kind -cne 'numen' -or
            !$seat.bodyId -or !$seat.ownerId -or $seat.bodyId -cne $roster[0].body_id -or $seat.ownerId -cne $roster[0].owner_id -or
            $seat.name -cne $spec.name -or $seat.serverId -cne $resident.serverId -or $seat.endpoint -cne $spec.endpoint -or
            $seat.tokenFile -cne $spec.tokenFile -or !$spec.externalHandoffFile -or
            [IO.Path]::GetFullPath($spec.externalHandoffFile) -ine [IO.Path]::GetFullPath($marker)) { throw 'Hosted role binding changed' }
        $h = Read-Json $roleHealth
        $s = Read-Json $coordination
        $role = @($h.roles | Where-Object id -ceq $Cfg.role)
        $roleReady = ($role.Count -eq 1 -and $role[0].bodyId -ceq $seat.bodyId -and !$h.pausing -and
            ((Get-Item -LiteralPath $roleHealth).LastWriteTimeUtc -gt $now.UtcDateTime.AddSeconds(-15)))
        $gameReady = $s.gameAvailable -and !$s.maintenance -and $s.children.npc.running -and
            ([double]$s.time -gt $now.ToUnixTimeSeconds()-15)
        $launch = if (Test-Path -LiteralPath $reportPath) { Read-Json $reportPath }
        $candidates = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
            Where-Object { Test-CorticoCli $_ $Cfg.node $Cfg.deployment })
        $cli = if ($candidates.Count -eq 1) { $candidates[0] }
        $verified = Test-RecordedCortico $cli $launch
        $listeners = @(Get-NetTCPConnection -State Listen |
            Where-Object LocalPort -eq ([int]$Cfg.port))
        $kind = 'absent'
        $worldActive = $false
        if ($listeners.Count) {
            $kind = 'foreign'
            if ($listeners.Count -eq 1 -and $listeners[0].LocalAddress -ceq '127.0.0.1' -and $verified) {
                $worker = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [int]$listeners[0].OwningProcess)
                if (Test-CorticoListener $worker $cli $Cfg.node $Cfg.repo $Cfg.deployment) {
                    $kind = 'owned'
                    try {
                        $worlds = Invoke-RestMethod -Uri ("http://127.0.0.1:" + [int]$Cfg.port + '/api/worlds') -TimeoutSec 4 -MaximumRedirection 0
                        $worldActive = @( $worlds.worlds | Where-Object { $_.id -ceq $Cfg.world -and $_.status -ceq 'active' } ).Count -eq 1
                    } catch { $worldActive = $false }
                }
            }
        }
        $markerState = 'missing'
        $prior = $null
        $owned = $false
        $stamp = if ($cli) { ([datetime]$cli.CreationDate).ToUniversalTime().ToString('o') }
        if (Test-Path -LiteralPath $marker) {
            if ((Get-Item -LiteralPath $marker).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw 'Invalid coordination file' }
            $prior = [IO.File]::ReadAllText($marker)
            $m = $prior | ConvertFrom-Json
            $sameRole = $m.bodyId -ceq $seat.bodyId -and $m.ownerId -ceq $seat.ownerId
            $recordedStart = if ($m.startedUtc) { ([datetimeoffset]$m.startedUtc).UtcDateTime.ToString('o') }
            $owned = $sameRole -and $m.controller -ceq 'hosted-cortico-watchdog/v1' -and $launch -and
                $m.processId -eq $launch.corticoPid -and $recordedStart -and (!$cli -or $recordedStart -ceq $stamp)
            $markerState = if ($owned) { 'owned' } elseif ($sameRole -and $m.until -is [ValueType] -and
                [double]$m.until -lt $now.ToUnixTimeSeconds()-5) { 'expired' } else { 'foreign' }
        }
        $state = Get-RecoveryDecision @{
            GameReady=$gameReady; RoleReady=$roleReady; Unknown=$role[0].unknownRequests
            CliCount=$candidates.Count; CliVerified=$verified; Listener=$kind; WorldActive=$worldActive
            NativeConnected=$role[0].health.connected; NativeAvailable=($role[0].controlMode -ceq 'available_for_external_controller')
            Marker=$markerState; PreviousAdoption=$owned
        }
        if ($state -ceq 'adopted') {
            $until = $now.ToUnixTimeSeconds()+150
            $text = [ordered]@{ bodyId=$seat.bodyId; ownerId=$seat.ownerId; until=$until
                controller='hosted-cortico-watchdog/v1'; processId=$cli.ProcessId; startedUtc=$stamp } | ConvertTo-Json -Compress
            Write-Atomic $marker $text $prior
            Write-WatchStatus $Cfg $state $cli.ProcessId ([datetimeoffset]::FromUnixTimeSeconds($until).ToString('o')) $null
        } elseif ($state -ceq 'request_launcher') {
            if ($owned -and [IO.File]::ReadAllText($marker) -ceq $prior) { [IO.File]::Delete($marker) }
            $restartRequested = $true
        } else {
            Write-WatchStatus $Cfg $state $cli.ProcessId $null $null
        }
    } finally { $lock.Dispose() }
    if ($restartRequested) {
        if (!(Test-Path -LiteralPath $stop) -and !(Test-Path -LiteralPath (Join-Path $Cfg.residentRoot 'maintenance.pause'))) {
            if ((Get-ScheduledTask -TaskName $Cfg.launchTask).State -eq 'Ready') {
                Start-ScheduledTask -TaskName $Cfg.launchTask
                Write-WatchStatus $Cfg 'launcher_requested' $null $null $null
            } else { Write-WatchStatus $Cfg 'launcher_busy' $null $null $null }
        }
    }
}

if (!$Library) {
    $cfg = Read-Json $Config
    try { Invoke-RecoveryTick $cfg }
    catch {
        Write-WatchStatus $cfg 'watchdog_error' $null $null $_.Exception.GetType().Name
        throw
    }
}
