param(
    [ValidateSet('Start', 'Stop', 'Restart', 'Status', 'Watchdog', 'Backup', 'Mirror')]
    [string]$Action = 'Status'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$serverDir = 'E:\MC\server'
$opsDir = 'E:\MC\ops'
$backupRoot = 'E:\MC\backups\scheduled'
$mirrorRoot = 'F:\MC-backups\scheduled'
$java = 'E:\MC\jdk\jdk-21.0.12.1+1\bin\java.exe'
$node = 'C:\Users\lzl19\AppData\Local\hermes\node\node.exe'
$lanHost = '192.168.3.163'
$gatewayScript = Join-Path $opsDir 'agent-lan-gateway.mjs'
$goddessScript = Join-Path $opsDir 'goddess-bridge.mjs'
$goddessControlScript = Join-Path $opsDir 'goddess-bridge-control.mjs'
$spectateWatcherScript = Join-Path $opsDir 'spectate-watcher.mjs'
$pausedFile = Join-Path $opsDir 'auto-start.paused'
$repairFile = Join-Path $opsDir 'repair-no-rcon.requested'
$lockFile = Join-Path $opsDir 'manage-server.lock'
$eventLog = Join-Path $opsDir 'manage-server.log'
$bedrockHealthFile = Join-Path $opsDir 'bedrock-health.json'
$pendingAgentFriendDeploy = Join-Path $opsDir 'agentfriend-deploy.pending.json'

function Log([string]$message) {
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Action, $message
    Add-Content -LiteralPath $eventLog -Value $line -Encoding UTF8
    Write-Host $line
}

function Listener {
    @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 25565 -State Listen -ErrorAction SilentlyContinue)
}

function GatewayListener {
    @(Get-NetTCPConnection -LocalAddress $lanHost -LocalPort 25565 -State Listen -ErrorAction SilentlyContinue)
}

function GoddessProcess {
    $listeners = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 25576 -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { return @() }
    if ($listeners.Count -ne 1) { throw 'Multiple Goddess control listeners.' }
    $reply = & $node $goddessControlScript status 2>&1
    if ($LASTEXITCODE -ne 0 -or ($reply -join "`n") -notmatch '^GODDESS-BRIDGE-V1 \d+$') {
        throw 'Port 127.0.0.1:25576 belongs to an unexpected or unhealthy process.'
    }
    if ([int]$Matches[0].Split(' ')[1] -ne $listeners[0].OwningProcess) {
        throw 'Goddess control PID does not own its listener.'
    }
    return $listeners
}

function SpectateWatcherProcess {
    @(Get-CimInstance Win32_Process -Filter "name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -eq $node -and $_.CommandLine -like "*$spectateWatcherScript*" })
}

function Start-SpectateWatcher {
    $existing = @(SpectateWatcherProcess)
    if ($existing.Count -gt 1) { throw 'Multiple spectate watcher processes; manual inspection required.' }
    if ($existing.Count -eq 1) { return }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdout = Join-Path $opsDir "spectate-watcher-$stamp.log"
    $stderr = Join-Path $opsDir "spectate-watcher-$stamp.error.log"
    $proc = Start-Process -FilePath $node -ArgumentList $spectateWatcherScript -WorkingDirectory $opsDir `
        -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    Start-Sleep -Seconds 2
    $proc.Refresh()
    if ($proc.HasExited) { throw "Spectate watcher exited; inspect $stderr" }
    Log "Spectate watcher running PID=$($proc.Id), log=$stdout"
}

function Stop-SpectateWatcher {
    $existing = @(SpectateWatcherProcess)
    if ($existing.Count -gt 1) { throw 'Multiple spectate watcher processes; manual inspection required.' }
    if ($existing.Count -eq 0) { return }
    Stop-Process -Id $existing[0].ProcessId -ErrorAction Stop
    Start-Sleep -Milliseconds 700
    Log 'Spectate watcher stopped'
}

function Start-Goddess {
    $existing = @(GoddessProcess)
    if ($existing.Count -eq 1) { return }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdout = Join-Path $opsDir "goddess-bridge-$stamp.log"
    $stderr = Join-Path $opsDir "goddess-bridge-$stamp.error.log"
    $proc = Start-Process -FilePath $node -ArgumentList $goddessScript -WorkingDirectory $opsDir `
        -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $deadline) {
        $proc.Refresh()
        if ($proc.HasExited) { throw "Goddess bridge exited; inspect $stdout and $stderr" }
        if (GoddessProcess) { Log "Goddess bridge running PID=$($proc.Id), log=$stdout"; return }
        Start-Sleep -Milliseconds 200
    }
    throw "Goddess control listener did not start; inspect $stdout and $stderr"
}

function Stop-Goddess {
    $existing = @(GoddessProcess)
    if ($existing.Count -eq 0) { return }
    $reply = & $node $goddessControlScript stop 2>&1
    if ($LASTEXITCODE -ne 0 -or ($reply -join "`n") -notmatch '^STOPPING$') {
        throw "Goddess bridge cooperative stop failed: $($reply -join ' ')"
    }
    $deadline = (Get-Date).AddSeconds(10)
    while (GoddessProcess) {
        if ((Get-Date) -gt $deadline) { throw 'Goddess control listener did not stop.' }
        Start-Sleep -Milliseconds 200
    }
    Log 'Goddess bridge stopped'
}

function Assert-GatewayProcess([int]$processId) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction Stop
    if (-not $process -or $process.ExecutablePath -ne $node -or
        $process.CommandLine -notlike "*$gatewayScript*") {
        throw "Port ${lanHost}:25565 belongs to an unexpected process (PID $processId)."
    }
}

function Start-Gateway {
    $listeners = @(GatewayListener)
    if ($listeners.Count -gt 0) {
        if ($listeners.Count -ne 1) { throw 'Agent LAN gateway has multiple listeners.' }
        Assert-GatewayProcess $listeners[0].OwningProcess
        return
    }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdout = Join-Path $opsDir "agent-lan-gateway-$stamp.log"
    $stderr = Join-Path $opsDir "agent-lan-gateway-$stamp.error.log"
    $process = Start-Process -FilePath $node -ArgumentList $gatewayScript -WorkingDirectory $opsDir `
        -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $deadline = (Get-Date).AddSeconds(12)
    while ((Get-Date) -lt $deadline) {
        $process.Refresh()
        if ($process.HasExited) { throw "Agent LAN gateway exited; inspect $stderr" }
        if (GatewayListener) {
            Assert-GatewayProcess $process.Id
            $response = & $node 'E:\MC\mcstatus.mjs' $lanHost '25565' '766' 2>&1
            if ($LASTEXITCODE -ne 0) { throw "Agent LAN gateway probe failed: $($response -join ' ')" }
            Log "Agent LAN gateway ready: $($response -join ' ')"
            return
        }
        Start-Sleep -Milliseconds 200
    }
    throw "Agent LAN gateway did not listen; inspect $stderr"
}

function Stop-Gateway {
    $listeners = @(GatewayListener)
    if ($listeners.Count -eq 0) { return }
    if ($listeners.Count -ne 1) { throw 'Agent LAN gateway has multiple listeners.' }
    $processId = [int]$listeners[0].OwningProcess
    Assert-GatewayProcess $processId
    Stop-Process -Id $processId -ErrorAction Stop
    $deadline = (Get-Date).AddSeconds(12)
    while (GatewayListener) {
        if ((Get-Date) -gt $deadline) { throw 'Agent LAN gateway did not stop.' }
        Start-Sleep -Milliseconds 200
    }
    Log 'Agent LAN gateway stopped'
}

function Rcon([string]$command) {
    $out = & $node 'E:\MC\probe\rcon.mjs' $command 2>&1
    if ($LASTEXITCODE -ne 0) { throw "RCON $command failed: $($out -join ' ')" }
    $out -join "`n"
}

function PlayerRoster {
    $reply = Rcon 'minecraft:list'
    if ($reply -notmatch '(?m)^There are (\d+) of a max of \d+ players online:\s*([^\r\n]*)') {
        throw "Could not parse Minecraft player roster: $reply"
    }
    $count = [int]$Matches[1]
    $names = @()
    $text = $Matches[2].Trim()
    if ($text) { $names = @($text -split ',\s*' | ForEach-Object { $_.Trim() }) }
    if ($names.Count -ne $count -or @($names | Where-Object { $_ -notmatch '^[A-Za-z0-9_.-]{1,16}$' }).Count) {
        throw "Minecraft player roster is incomplete or malformed: $reply"
    }
    return [pscustomobject]@{ Count = $count; Names = $names }
}

function HumanPlayers {
    $serviceNames = @('CortiLan', 'CortiEye', 'Goddess')
    $roster = PlayerRoster
    @($roster.Names | Where-Object { $serviceNames -notcontains $_ })
}

function Probe {
    $out = & $node 'E:\MC\mcstatus.mjs' '127.0.0.1' '25565' '766' 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Java status failed: $($out -join ' ')" }
    $out -join "`n"
}

function BedrockProbe {
    $out = & $node 'E:\MC\bedrock-ping.mjs' $lanHost '19132' 2>&1
    if ($LASTEXITCODE -ne 0) { return $false }
    return (($out -join "`n") -match '(?m)^REPLY ')
}

function Check-BedrockHealth {
    if (BedrockProbe) {
        if (Test-Path -LiteralPath $bedrockHealthFile) {
            Remove-Item -LiteralPath $bedrockHealthFile -Force
            Log 'Bedrock Geyser probe recovered'
        }
        return
    }
    $state = @{ failures = 0; lastRestart = ''; attempted = $false; deferred = $false }
    if (Test-Path -LiteralPath $bedrockHealthFile) {
        try {
            $saved = Get-Content -LiteralPath $bedrockHealthFile -Raw | ConvertFrom-Json
            $state.failures = [int]$saved.failures
            $state.lastRestart = [string]$saved.lastRestart
            $state.attempted = [bool]$saved.attempted
            $state.deferred = [bool]$saved.deferred
        } catch { Log "WARN Bad Bedrock health state, resetting: $_" }
    }
    $state.failures++
    if ($state.failures -eq 1) { Log 'WARN Bedrock Geyser LAN ping failed; waiting for confirmation' }
    if ($state.failures -lt 3) {
        $state | ConvertTo-Json | Set-Content -LiteralPath $bedrockHealthFile -Encoding UTF8
        return
    }
    # One automatic restart per outage. A persistent external Geyser failure
    # must not repeatedly interrupt an otherwise healthy Java service.
    if ($state.attempted) {
        $state | ConvertTo-Json | Set-Content -LiteralPath $bedrockHealthFile -Encoding UTF8
        return
    }
    $humans = @(HumanPlayers)
    if ($humans.Count) {
        if (-not $state.deferred) { Log "WARN Bedrock recovery deferred; human player(s) online: $($humans -join ', ')" }
        $state.deferred = $true
        $state | ConvertTo-Json | Set-Content -LiteralPath $bedrockHealthFile -Encoding UTF8
        return
    }
    $state.lastRestart = (Get-Date).ToString('o')
    $state.attempted = $true
    $state.deferred = $false
    $state | ConvertTo-Json | Set-Content -LiteralPath $bedrockHealthFile -Encoding UTF8
    Log "Bedrock probe failed $($state.failures) times; restarting Paper with service accounts only"
    Stop-Server
    Start-Server
}

function NativeSpectateMirror {
    try {
        $reply = Rcon 'version CortiEyeMirror'
        return ($reply -match 'CortiEyeMirror.{0,15}version' -and $reply -match 'Author:')
    } catch { return $false }
}

function EnsureSpectatorBinding {
    if (NativeSpectateMirror) {
        # The native plugin reattaches the camera after either player joins.
        Stop-SpectateWatcher
    } else {
        Start-SpectateWatcher
    }
}

function Start-Server {
    if (Listener) {
        $status = Probe
        $null = Rcon 'minecraft:list'
        Start-Gateway
        try { Start-Goddess } catch { Log "WARN Goddess bridge: $_" }
        try { EnsureSpectatorBinding } catch { Log "WARN Spectator binding: $_" }
        Log "Already running: $status"
        return
    }
    # A JVM may still be loading before it opens 25565. Never launch a second copy.
    $other = @(Get-CimInstance Win32_Process -Filter "name='java.exe'" |
        Where-Object { $_.ExecutablePath -eq $java -and $_.CommandLine -match [regex]::Escape((Join-Path $serverDir 'server.jar')) })
    if ($other.Count -gt 0) { throw "Paper JVM is already starting or stuck (PID $($other.ProcessId -join ','))." }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdout = Join-Path $serverDir "startup-$stamp.log"
    $stderr = Join-Path $serverDir "startup-$stamp.error.log"
    $proc = Start-Process -FilePath $java -ArgumentList '-Xms1G','-Xmx4G','-jar',(Join-Path $serverDir 'server.jar'),'nogui' `
        -WorkingDirectory $serverDir -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    Log "Launching Paper PID=$($proc.Id), log=$stdout"
    $deadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $deadline) {
        $proc.Refresh()
        if ($proc.HasExited) { throw "Paper exited during startup. Read $stdout and $stderr" }
        if ((Test-Path -LiteralPath $stdout) -and
            (Select-String -LiteralPath $stdout -Pattern 'Done \([\d.]+s\)!' -Quiet)) {
            $status = Probe
            Start-Gateway
            if (-not (BedrockProbe)) { Log 'WARN Bedrock Geyser did not answer LAN ping after startup' }
            try { Start-Goddess } catch { Log "WARN Goddess bridge: $_" }
            try { EnsureSpectatorBinding } catch { Log "WARN Spectator binding: $_" }
            Log "Ready: $status"
            return
        }
        Start-Sleep -Seconds 1
    }
    throw "Paper did not become ready in 120 seconds. Read $stdout and $stderr"
}

function Stop-Server {
    Stop-SpectateWatcher
    Stop-Goddess
    Stop-Gateway
    if (-not (Listener)) { Log 'Already stopped'; return }
    $null = Probe  # Refuse to send stop to an unrelated listener.
    $null = Rcon 'save-all flush'
    $null = Rcon 'stop'
    $deadline = (Get-Date).AddSeconds(90)
    while (Listener) {
        if ((Get-Date) -gt $deadline) { throw 'Paper did not stop within 90 seconds.' }
        Start-Sleep -Seconds 1
    }
    Log 'Paper stopped cleanly'
}

function Repair-NoRcon {
    # This branch is reached only from an explicit one-shot request. It runs
    # inside the same scheduled-task security context that launched Paper.
    Remove-Item -LiteralPath $repairFile -Force
    $status = Probe
    if ($status -notmatch 'Paper 1\.20\.6 \(proto 766\)' -or $status -notmatch 'online 0/') {
        throw "Refusing no-RCON repair while players may be online: $status"
    }
    $properties = Get-Content -LiteralPath (Join-Path $serverDir 'server.properties') -Raw
    foreach ($expected in @('online-mode=false','enable-rcon=true','enforce-secure-profile=false')) {
        if ($properties -notmatch "(?m)^$([regex]::Escape($expected))$") {
            throw "Refusing no-RCON repair: disk config lacks $expected"
        }
    }
    if ($properties -notmatch '(?m)^rcon\.password=.+$') { throw 'RCON password is missing on disk.' }
    $pids = @((Listener).OwningProcess | Select-Object -Unique)
    if ($pids.Count -ne 1) { throw 'Could not uniquely identify the Paper JVM.' }
    $proc = Get-Process -Id $pids[0] -ErrorAction Stop
    if ($proc.ProcessName -ne 'java') { throw 'Port 25565 is not owned by Java.' }
    Log "Sending console Ctrl+C to unhealthy Paper PID=$($pids[0])"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $opsDir 'send-console-ctrl-c.ps1') -TargetPid $pids[0]
    if ($LASTEXITCODE -ne 0) { throw 'Console Ctrl+C failed; auto-start remains paused.' }
    $deadline = (Get-Date).AddSeconds(90)
    while (Listener) {
        if ((Get-Date) -gt $deadline) { throw 'Paper did not stop after Ctrl+C; auto-start remains paused.' }
        Start-Sleep -Seconds 1
    }
    Start-Server
    Remove-Item -LiteralPath $pausedFile -Force -ErrorAction SilentlyContinue
    Log 'No-RCON repair completed'
}

function CompleteSnapshots([string]$path) {
    @(Get-ChildItem -LiteralPath $path -Directory -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -match '^\d{8}-\d{6}$' -and (Test-Path -LiteralPath (Join-Path $_.FullName '.complete'))
    } | Sort-Object Name -Descending)
}

function PruneSnapshots([string]$path) {
    # Keep 14 most recent snapshots plus one from each of the latest 14 backup
    # days. Manual maintenance must not erase every older recovery point.
    $root = [IO.Path]::GetFullPath($path).TrimEnd('\')
    $completed = @(CompleteSnapshots $root)
    $recent = @($completed | Select-Object -First 14)
    $daily = @($completed | Group-Object { $_.Name.Substring(0, 8) } |
        ForEach-Object { $_.Group | Select-Object -First 1 } |
        Sort-Object Name -Descending | Select-Object -First 14)
    $keep = @($recent + $daily | ForEach-Object { $_.FullName } | Select-Object -Unique)
    foreach ($old in @($completed | Where-Object { $keep -notcontains $_.FullName })) {
        $resolved = [IO.Path]::GetFullPath($old.FullName).TrimEnd('\')
        if (-not $resolved.StartsWith(($root + '\'), [StringComparison]::OrdinalIgnoreCase) -or
            $old.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) {
            throw "Unsafe backup retention path: $resolved"
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
        Log "Expired backup removed: $resolved"
    }
}

function Assert-MirrorHashes([string]$sourcePath, [string]$mirrorPath) {
    foreach ($relative in @('server\server.jar', 'server\world\level.dat', 'ops\manage-server.ps1', 'backup.json')) {
        $a = Join-Path $sourcePath $relative
        $b = Join-Path $mirrorPath $relative
        if (-not (Test-Path -LiteralPath $b) -or
            (Get-FileHash -LiteralPath $a -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $b -Algorithm SHA256).Hash) {
            throw "Mirror hash mismatch: $relative; inspect $mirrorPath"
        }
    }
}

function Mirror-LatestBackup {
    $source = CompleteSnapshots $backupRoot | Select-Object -First 1
    if (-not $source) { throw 'No verified local backup to mirror.' }
    if ($source.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw 'Refusing reparse-point backup source.' }
    if (-not (Test-Path -LiteralPath 'F:\')) { throw 'Mirror drive F: is unavailable.' }
    New-Item -ItemType Directory -Path $mirrorRoot -Force | Out-Null
    $destination = Join-Path $mirrorRoot $source.Name
    if (Test-Path -LiteralPath (Join-Path $destination '.complete')) {
        Assert-MirrorHashes $source.FullName $destination
        Log "Mirror already complete and verified: $destination"
        return
    }
    $stage = "$destination.partial"
    if ((Test-Path -LiteralPath $destination) -or (Test-Path -LiteralPath $stage)) {
        throw "Incomplete mirror requires inspection: $destination or $stage"
    }
    $sourceBytes = (Get-ChildItem -LiteralPath $source.FullName -Recurse -File | Measure-Object -Property Length -Sum).Sum
    if ((Get-PSDrive -Name F).Free -lt ($sourceBytes + 1GB)) {
        throw 'Mirror skipped: F: needs at least snapshot size plus 1 GB free.'
    }
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    & robocopy.exe $source.FullName $stage /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /XF '.complete' | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Mirror robocopy failed with exit code $LASTEXITCODE; inspect $stage" }
    Assert-MirrorHashes $source.FullName $stage
    $resolvedStage = [IO.Path]::GetFullPath($stage).TrimEnd('\')
    $resolvedRoot = [IO.Path]::GetFullPath($mirrorRoot).TrimEnd('\')
    if (-not $resolvedStage.StartsWith(($resolvedRoot + '\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe mirror path: $resolvedStage"
    }
    Rename-Item -LiteralPath $stage -NewName $source.Name
    New-Item -ItemType File -Path (Join-Path $destination '.complete') -Force | Out-Null
    Log "Mirror complete: $destination"
    PruneSnapshots $mirrorRoot
}

function Deploy-PendingAgentFriend {
    if (-not (Test-Path -LiteralPath $pendingAgentFriendDeploy)) { return }
    $plan = Get-Content -LiteralPath $pendingAgentFriendDeploy -Raw | ConvertFrom-Json
    $source = [IO.Path]::GetFullPath([string]$plan.source)
    $sourceRoot = 'E:\minecraft-ai-friend\paper\plugins\AgentFriend\'
    $targetName = [IO.Path]::GetFileName($source)
    if (-not $source.StartsWith($sourceRoot, [StringComparison]::OrdinalIgnoreCase) -or
        $targetName -notmatch '^AgentFriend-\d+\.\d+\.\d+\.jar$' -or
        $plan.sha256 -notmatch '^[0-9a-fA-F]{64}$' -or
        $plan.previousSha256 -notmatch '^[0-9a-fA-F]{64}$' -or
        -not (Test-Path -LiteralPath $source)) { throw 'Pending AgentFriend deployment is invalid.' }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $plan.sha256) {
        throw 'Pending AgentFriend source hash changed.'
    }
    $enabled = @(Get-ChildItem -LiteralPath (Join-Path $serverDir 'plugins') -Filter 'AgentFriend-*.jar' -File)
    if ($enabled.Count -ne 1 -or
        (Get-FileHash -LiteralPath $enabled[0].FullName -Algorithm SHA256).Hash -ne $plan.previousSha256) {
        throw 'Expected previous AgentFriend JAR is not the only enabled version.'
    }
    $old = $enabled[0].FullName
    $oldDisabled = "$old.disabled"
    $new = Join-Path $serverDir "plugins\$targetName"
    $staged = "$new.pending"
    if ((Test-Path -LiteralPath $oldDisabled) -or (Test-Path -LiteralPath $new) -or
        (Test-Path -LiteralPath $staged)) { throw 'AgentFriend deployment target already exists.' }
    try {
        Copy-Item -LiteralPath $source -Destination $staged
        if ((Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash -ne $plan.sha256) {
            throw 'Staged AgentFriend JAR hash mismatch.'
        }
        Rename-Item -LiteralPath $old -NewName ([IO.Path]::GetFileName($oldDisabled))
        Rename-Item -LiteralPath $staged -NewName $targetName
    } catch {
        Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path -LiteralPath $old) -and (Test-Path -LiteralPath $oldDisabled)) {
            Rename-Item -LiteralPath $oldDisabled -NewName ([IO.Path]::GetFileName($old))
        }
        Move-Item -LiteralPath $pendingAgentFriendDeploy -Destination "$pendingAgentFriendDeploy.failed" -Force
        throw
    }
    Remove-Item -LiteralPath $pendingAgentFriendDeploy -Force
    Log "AgentFriend deployed: $targetName SHA256=$($plan.sha256)"
}

function Backup-Server {
    $sourceBytes = (Get-ChildItem -LiteralPath $serverDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
    $freeBytes = (Get-PSDrive -Name E).Free
    if ($null -eq $freeBytes -or $freeBytes -lt ($sourceBytes + 1GB)) {
        throw "Backup skipped before stopping Paper: E: needs at least source size plus 1 GB free"
    }
    $wasRunning = [bool](Listener)
    $wasPaused = Test-Path -LiteralPath $pausedFile
    if ($wasRunning) {
        # A 24/7 Agent or spectator must not block recovery points. Never
        # disconnect anyone if an unknown (human) name is present.
        $humans = @(HumanPlayers)
        if ($humans.Count) { Log "Backup skipped: human player(s) online: $($humans -join ', ')"; return }
        $goddessStopped = $false
        $proceed = $false
        try {
            Stop-Goddess
            $goddessStopped = $true
            $humans = @(HumanPlayers)
            if ($humans.Count) { Log "Backup skipped: human joined during preflight: $($humans -join ', ')"; return }
            $proceed = $true
        } finally {
            if (-not $proceed -and $goddessStopped) { try { Start-Goddess } catch { Log "WARN Goddess bridge restart: $_" } }
        }
    }
    New-Item -ItemType File -Path $pausedFile -Force | Out-Null
    $startedAgain = $false
    try {
        if ($wasRunning) { Stop-Server }
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $dest = Join-Path $backupRoot $stamp
        $copyDest = Join-Path $dest 'server'
        New-Item -ItemType Directory -Path $copyDest -Force | Out-Null
        & robocopy.exe $serverDir $copyDest /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "Robocopy failed with exit code $LASTEXITCODE. Incomplete backup: $dest" }
        # Save the deployment scripts and probes alongside the world. Runtime
        # locks, control tokens, and logs are intentionally not restorable.
        $opsCopy = Join-Path $dest 'ops'
        & robocopy.exe $opsDir $opsCopy /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP `
            /XF '*.log' '*.jsonl' 'manage-server.lock' 'auto-start.paused' 'bedrock-health.json' 'goddess-bridge.control.json' 'repair-no-rcon.requested' 'last-backup.txt' 'agentfriend-deploy.pending.json' | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "Ops backup failed with exit code $LASTEXITCODE. Incomplete backup: $dest" }
        $probeCopy = Join-Path $dest 'probe'
        & robocopy.exe 'E:\MC\probe' $probeCopy /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /XD 'node_modules' | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "Probe backup failed with exit code $LASTEXITCODE. Incomplete backup: $dest" }
        $rootCopy = Join-Path $dest 'root'
        New-Item -ItemType Directory -Path $rootCopy -Force | Out-Null
        foreach ($name in @('mcstatus.mjs', 'bedrock-ping.mjs', 'start-mc.bat')) {
            Copy-Item -LiteralPath (Join-Path 'E:\MC' $name) -Destination (Join-Path $rootCopy $name) -Force
        }
        foreach ($relative in @('server.jar','server.properties','ops.json','world\level.dat')) {
            $sourceFile = Join-Path $serverDir $relative
            $copyFile = Join-Path $copyDest $relative
            if (-not (Test-Path -LiteralPath $copyFile)) { throw "Backup missing $relative" }
            $sourceHash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash
            $copyHash = (Get-FileHash -LiteralPath $copyFile -Algorithm SHA256).Hash
            if ($sourceHash -ne $copyHash) { throw "Backup hash mismatch: $relative" }
        }
        foreach ($support in @(
            @{ Source = (Join-Path $opsDir 'manage-server.ps1'); Copy = (Join-Path $opsCopy 'manage-server.ps1') },
            @{ Source = (Join-Path $opsDir 'goddess-bridge.mjs'); Copy = (Join-Path $opsCopy 'goddess-bridge.mjs') },
            @{ Source = (Join-Path $opsDir 'agent-lan-gateway.mjs'); Copy = (Join-Path $opsCopy 'agent-lan-gateway.mjs') },
            @{ Source = 'E:\MC\probe\rcon.mjs'; Copy = (Join-Path $probeCopy 'rcon.mjs') },
            @{ Source = 'E:\MC\mcstatus.mjs'; Copy = (Join-Path $rootCopy 'mcstatus.mjs') },
            @{ Source = 'E:\MC\bedrock-ping.mjs'; Copy = (Join-Path $rootCopy 'bedrock-ping.mjs') }
        )) {
            if (-not (Test-Path -LiteralPath $support.Copy)) { throw "Backup missing $($support.Copy)" }
            if ((Get-FileHash -LiteralPath $support.Source -Algorithm SHA256).Hash -ne
                (Get-FileHash -LiteralPath $support.Copy -Algorithm SHA256).Hash) {
                throw "Backup hash mismatch: $($support.Source)"
            }
        }
        @{ createdAt = (Get-Date).ToString('o'); source = $serverDir; stoppedForCopy = $wasRunning;
           serverJarSha256 = (Get-FileHash -LiteralPath (Join-Path $copyDest 'server.jar') -Algorithm SHA256).Hash } |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dest 'backup.json') -Encoding UTF8
        New-Item -ItemType File -Path (Join-Path $dest '.complete') -Force | Out-Null
        Log "Backup complete: $dest"
        Deploy-PendingAgentFriend
    }
    finally {
        if ($wasRunning) {
            try { Start-Server; $startedAgain = $true }
            catch { Log "CRITICAL: Paper restart after backup failed: $_"; throw }
        } else { $startedAgain = $true }
        if ($startedAgain -and -not $wasPaused) {
            Remove-Item -LiteralPath $pausedFile -Force -ErrorAction SilentlyContinue
        }
    }
    PruneSnapshots $backupRoot
    Mirror-LatestBackup
}

if ($Action -eq 'Status') {
    if (Listener) {
        Write-Host (Probe)
        Write-Host (Rcon 'minecraft:list')
    } else { Write-Host 'Paper stopped' }
    Write-Host "Agent LAN gateway: $(if (GatewayListener) { 'listening' } else { 'stopped' })"
    Write-Host "Bedrock Geyser: $(if ((Listener) -and (BedrockProbe)) { 'replying' } else { 'not responding' })"
    Write-Host "Goddess bridge: $(if (GoddessProcess) { 'running' } else { 'stopped' })"
    Write-Host "CortiEye native mirror: $(if ((Listener) -and (NativeSpectateMirror)) { 'loaded' } else { 'not loaded' })"
    Write-Host "Spectate watcher: $(if (SpectateWatcherProcess) { 'running' } else { 'stopped' })"
    Write-Host "Auto-start paused: $(Test-Path -LiteralPath $pausedFile)"
    $latestBackup = CompleteSnapshots $backupRoot | Select-Object -First 1
    $latestMirror = CompleteSnapshots $mirrorRoot | Select-Object -First 1
    $backupAge = if ($latestBackup) { [math]::Round(((Get-Date) - $latestBackup.CreationTime).TotalHours, 1) } else { $null }
    Write-Host "Latest verified backup: $(if ($latestBackup) { "$($latestBackup.Name) ($backupAge h ago)" } else { 'none' })"
    Write-Host "Latest F: mirror: $(if ($latestMirror) { $latestMirror.Name } else { 'none' })"
    Write-Host "E: free: $([math]::Round((Get-PSDrive -Name E).Free / 1GB, 1)) GB"
    Write-Host "Bedrock recovery pending: $(Test-Path -LiteralPath $bedrockHealthFile)"
    exit 0
}

New-Item -ItemType Directory -Path $opsDir -Force | Out-Null
$lock = $null
$lockDeadline = (Get-Date).AddSeconds($(if ($Action -eq 'Watchdog') { 2 } else { 120 }))
while (-not $lock) {
    try { $lock = [IO.File]::Open($lockFile, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch [IO.IOException] {
        if ((Get-Date) -gt $lockDeadline) {
            if ($Action -eq 'Watchdog') { exit 0 }
            throw 'Another Minecraft maintenance action is still running.'
        }
        Start-Sleep -Milliseconds 250
    }
}
try {
    switch ($Action) {
        'Start' {
            Start-Server
            Remove-Item -LiteralPath $pausedFile -Force -ErrorAction SilentlyContinue
        }
        'Stop' {
            New-Item -ItemType File -Path $pausedFile -Force | Out-Null
            Stop-Server
        }
        'Restart' {
            New-Item -ItemType File -Path $pausedFile -Force | Out-Null
            Stop-Server
            Start-Server
            Remove-Item -LiteralPath $pausedFile -Force -ErrorAction SilentlyContinue
        }
        'Backup' { Backup-Server }
        'Mirror' { Mirror-LatestBackup }
        'Watchdog' {
            if (Test-Path -LiteralPath $repairFile) { Repair-NoRcon; break }
            if (Test-Path -LiteralPath $pausedFile) { exit 0 }
            if (Listener) { $null = Probe; $null = Rcon 'minecraft:list'; Start-Gateway; Start-Goddess; EnsureSpectatorBinding; Check-BedrockHealth }
            else { Start-Server }
        }
    }
}
catch {
    Log "ERROR: $_"
    throw
}
finally { if ($lock) { $lock.Dispose() } }
