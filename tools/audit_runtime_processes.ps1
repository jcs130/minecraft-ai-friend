<#
Read-only, credential-minimizing audit of QiandengJi and legacy shadow runtimes.
Raw CIM command lines, task arguments, container inspection/environment and logs
remain in process memory. Only explicit projections below are persisted. This
tool never stops/restarts services, executes startup scripts, or reads secrets.
#>
[CmdletBinding()]
param([string]$OutputPath = 'D:\Projects\QiandengJi\reports\host-runtime-audit.json')
$ErrorActionPreference = 'Stop'
$ProjectRoot = 'D:\Projects\QiandengJi'
$LegacyRoot = 'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend'
$ShadowRoot = Join-Path $LegacyRoot 'ops\docker\shadow'
$fullOutput = [IO.Path]::GetFullPath($OutputPath)
if (-not $fullOutput.StartsWith($ProjectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Output must remain in the D project.' }
$startedAt = [DateTimeOffset]::UtcNow.ToString('o')
$scopePattern = '(?i)minecraft-ai-friend|qiandengji|qwenpaw(?:\.exe|_autostart|\.cmd|\.ps1)|[\\/]qwenpaw[\\/]|host_tcp_relay|mcp_numen|shadow-'
$excludedPattern = '(?i)codex|cua|playwright|chatgpt|chromium|msedge'
function Iso($v) { if ($null -eq $v) { return $null }; try { return ([DateTimeOffset]$v).ToString('o') } catch { return $null } }
function Safe-Paths([string]$v) {
    @([regex]::Matches($v, '(?i)[A-Z]:[\\/][^"\r\n]*?\.(?:py|ps1|bat|cmd|vbs|mjs|mts|cjs|js|exe)') | ForEach-Object { $_.Value } | Where-Object {
        ($_ -match $scopePattern -or $_ -like 'C:\Users\lzl19\.qwenpaw\venv\Scripts\*') -and $_ -notmatch $excludedPattern
    } | Sort-Object -Unique)
}
function Safe-Action([string]$v) {
    [pscustomobject]@{
        paths = @(Safe-Paths $v)
        flags = @([regex]::Matches($v, '(?i)--(?:auto|report|listen-port\s+\d{1,5}|target-port\s+\d{1,5}|target-host\s+(?:127\.0\.0\.1|localhost))\b') | ForEach-Object { $_.Value })
        namedContainers = @([regex]::Matches($v, '(?i)\bshadow-[a-z0-9_-]+\b|\bmc-direct\b') | ForEach-Object { $_.Value } | Sort-Object -Unique)
        dockerVerbs = @([regex]::Matches($v, '(?i)\bdocker\s+(?:start|restart|stop|compose|exec|ps)\b') | ForEach-Object { $_.Value } | Sort-Object -Unique)
        rawArgumentsOmitted = $true
    }
}
function Safe-Endpoint([string]$v) {
    try { $u = [uri]$v; if ($u.Scheme -in @('http','https','redis','bolt','mqtt','ws','wss')) {
        # No userinfo, query, fragment, path or original URL is retained.
        return [pscustomobject]@{scheme=$u.Scheme;host=$u.Host;port=$u.Port}
    } } catch {}
    return $null
}
function Normalize-Mount([string]$p) {
    $p = $p.Replace('\','/').ToLowerInvariant()
    $p = $p -replace '^/run/desktop/mnt/host/([a-z])/', '$1:/'
    return $p.TrimEnd('/')
}
function File-Summary([string]$p) {
    if (-not (Test-Path -LiteralPath $p)) { return [pscustomobject]@{path=$p;exists=$false} }
    $f = Get-Item -LiteralPath $p
    if ($f.PSIsContainer) {
        $fs = @(Get-ChildItem -LiteralPath $p -File)
        return [pscustomobject]@{path=$p;exists=$true;fileCount=$fs.Count;bytes=($fs | Measure-Object Length -Sum).Sum;latestWrite=Iso (($fs | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc);contentsRead=$false}
    }
    return [pscustomobject]@{path=$p;exists=$true;bytes=$f.Length;latestWrite=Iso $f.LastWriteTimeUtc;contentsRead=$false}
}
$coverage = [ordered]@{}
$allProcesses = @(Get-CimInstance Win32_Process)
$processById = @{}; foreach ($p in $allProcesses) { $processById[[int]$p.ProcessId] = $p }
$tcp = @(); $udp = @()
try { $tcp = @(Get-NetTCPConnection); $coverage.tcp = 'ok' } catch { $coverage.tcp = 'unavailable:' + $_.Exception.GetType().Name }
try { $udp = @(Get-NetUDPEndpoint); $coverage.udp = 'ok' } catch { $coverage.udp = 'unavailable:' + $_.Exception.GetType().Name }
$processRows = @(); $unreadableRuntimeCount = 0; $otherSharedVenvCount = 0
foreach ($p in $allProcesses) {
    if ($p.Name -notmatch '^(?i:pythonw?|node|javaw?|qwenpaw|copaw)\.exe$') { continue }
    if (-not $p.CommandLine) { $unreadableRuntimeCount++; continue }
    if ($p.CommandLine -notmatch $scopePattern) {
        # A shared interpreter path alone is not evidence of a game/Qwen service.
        if ($p.ExecutablePath -match '(?i)[\\/]\.qwenpaw[\\/]') { $otherSharedVenvCount++ }
        continue
    }
    if ($p.CommandLine -match $excludedPattern) { continue }
    $parent = $processById[[int]$p.ParentProcessId]
    $ownTcp = @($tcp | Where-Object { $_.OwningProcess -eq $p.ProcessId })
    $logicalRole = if ($p.CommandLine -match 'host_tcp_relay\.py') { 'legacy-tcp-relay' } elseif ($p.CommandLine -match 'mcp_numen\.py') { 'numen-mcp-child' } elseif ($p.CommandLine -match '(?i)qwenpaw\.exe') { 'qwenpaw-console' } else { 'unknown-project-runtime' }
    $processRows += [pscustomobject]@{
        pid = [int]$p.ProcessId; parentPid = [int]$p.ParentProcessId; name = $p.Name
        logicalRole = $logicalRole
        executable = $p.ExecutablePath; startedAt = Iso $p.CreationDate
        parentPresent = $null -ne $parent
        parentIdentity = if ($null -ne $parent -and ($parent.CommandLine -match $scopePattern -or $parent.Name -match '^(?i:pythonw?|qwenpaw)\.exe$')) { $parent.Name } else { $null }
        action = Safe-Action $p.CommandLine
        tcpListen = @($ownTcp | Where-Object State -eq 'Listen' | ForEach-Object { [pscustomobject]@{address=$_.LocalAddress;port=$_.LocalPort} })
        udpListen = @($udp | Where-Object OwningProcess -eq $p.ProcessId | ForEach-Object { [pscustomobject]@{address=$_.LocalAddress;port=$_.LocalPort} })
        established = @($ownTcp | Where-Object State -eq 'Established' | Group-Object RemotePort | ForEach-Object { [pscustomobject]@{remotePort=[int]$_.Name;count=$_.Count;addressesOmitted=$true} })
    }
}
$coverage.runtimeCommandLineUnavailableCount = $unreadableRuntimeCount
$coverage.otherSharedVenvRuntimeCount = $otherSharedVenvCount
$taskRows = @(); $taskCount = 0; $nonProjectTaskMatches = 0
try {
    $tasks = @(Get-ScheduledTask); $taskCount = $tasks.Count
    foreach ($t in $tasks) {
        $joined = ($t.Actions | ForEach-Object { $_.Execute + ' ' + $_.Arguments + ' ' + $_.WorkingDirectory }) -join ' '
        if (($t.TaskName + ' ' + $joined) -notmatch '(?i)minecraft-ai-friend|qiandengji|qwenpaw[-_]|host_tcp_relay|MC-Terra|mc_health|god-voice|god-tts|MCHostRelay') { continue }
        if ($joined -match $excludedPattern) { continue }
        $i = $null; try { $i = Get-ScheduledTaskInfo -TaskName $t.TaskName -TaskPath $t.TaskPath } catch {}
        $taskRows += [pscustomobject]@{
            name=$t.TaskName;path=$t.TaskPath;state=[string]$t.State;action=(Safe-Action $joined)
            lastRun=Iso $i.LastRunTime;nextRun=Iso $i.NextRunTime;lastResult=$i.LastTaskResult
            restartCount=$t.Settings.RestartCount;restartInterval=$t.Settings.RestartInterval
            triggers=@($t.Triggers | ForEach-Object { [pscustomobject]@{type=$_.CimClass.CimClassName;enabled=$_.Enabled;interval=$_.Repetition.Interval;start=$_.StartBoundary;end=$_.EndBoundary} })
        }
    }; $coverage.scheduledTasks = 'ok'
} catch { $coverage.scheduledTasks = 'unavailable:' + $_.Exception.GetType().Name }
$serviceRows = @(); $nssmUnreadable = 0; $nssmChecked = 0
try {
    foreach ($s in Get-CimInstance Win32_Service) {
        $v = $s.PathName; $nssm = $v -match '(?i)nssm'; $p = $null
        if ($nssm) { $nssmChecked++; try {
            # Never query/output AppEnvironment/AppEnvironmentExtra.
            $p = Get-ItemProperty -LiteralPath ('Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\' + $s.Name + '\Parameters') -Name Application,AppDirectory,AppParameters
            $v += ' ' + $p.Application + ' ' + $p.AppDirectory + ' ' + $p.AppParameters
        } catch { $nssmUnreadable++ } }
        if (($s.Name + ' ' + $v) -notmatch $scopePattern -or $v -match $excludedPattern) { continue }
        $serviceRows += [pscustomobject]@{name=$s.Name;state=$s.State;startMode=$s.StartMode;pid=$s.ProcessId;nssm=$nssm;action=(Safe-Action $v)}
    }; $coverage.services = 'ok'
} catch { $coverage.services = 'unavailable:' + $_.Exception.GetType().Name }
$coverage.nssmChecked = $nssmChecked; $coverage.nssmUnreadable = $nssmUnreadable
$startupRows = @()
try { foreach ($s in Get-CimInstance Win32_StartupCommand) {
    if (($s.Name + ' ' + $s.Command) -match $scopePattern -and $s.Command -notmatch $excludedPattern) {
        $startupRows += [pscustomobject]@{name=$s.Name;location=$s.Location;action=(Safe-Action $s.Command)}
    }
}; $coverage.startupCommand = 'ok' } catch { $coverage.startupCommand = 'unavailable:' + $_.Exception.GetType().Name }
$sourcePaths = @(
    'C:\Users\lzl19\scripts\qwenpaw_autostart.bat',
    'C:\Users\lzl19\scripts\qwenpaw_autostart_hidden.vbs',
    'C:\Users\lzl19\scripts\qwenpaw_autostart_core.bat',
    (Join-Path $LegacyRoot 'ops\docker\host_tcp_relay.py'),
    (Join-Path $LegacyRoot 'ops\health\health_mon.py'),
    (Join-Path $LegacyRoot 'sidecar\guard\mcp_numen.py'),
    (Join-Path $ShadowRoot 'viaproxy\roster-daily-refresh.bat')
)
$sourceRows = @()
foreach ($f in $sourcePaths) {
    if (-not (Test-Path -LiteralPath $f)) { $sourceRows += [pscustomobject]@{path=$f;exists=$false}; continue }
    $lines = @(Get-Content -LiteralPath $f); $hits = @()
    for ($n = 0; $n -lt $lines.Count; $n++) {
        $s = $lines[$n]
        if ($s -match '(?i)docker|compose|restart|watchdog-retired|host_tcp_relay|qwenpaw|start-process|stop-process|wscript') {
            $hits += [pscustomobject]@{line=$n+1;tokens=@([regex]::Matches($s, '(?i)\b(?:docker|compose|restart|start|stop|up|qwenpaw|host_tcp_relay|wscript|Start-Process|Stop-Process)\b|shadow-[a-z0-9_-]+|\.watchdog-retired') | ForEach-Object {$_.Value} | Sort-Object -Unique);comment=($s.TrimStart() -match '^#|^REM\b|^::')}
        }
    }
    $sourceRows += [pscustomobject]@{path=$f;exists=$true;sha256=(Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLower();lineCount=$lines.Count;evidence=$hits;rawSourceOmitted=$true}
}
$containerRows = @(); $inspections = @(); $dockerStatus = 'ok'
try {
    $names = @(& docker ps -a --filter label=com.docker.compose.project=shadow --format '{{.Names}}')
    $names += @(& docker ps -a --filter label=com.docker.compose.project=qiandengji --format '{{.Names}}')
    if ($LASTEXITCODE -ne 0) { throw 'Docker enumeration unavailable.' }
    foreach ($name in ($names | Sort-Object -Unique)) {
        if ($name -notmatch '^(shadow-[a-z0-9-]+|mc-direct|qiandengji-[a-z0-9-]+)$') { continue }
        $raw = & docker inspect $name 2>$null
        if ($LASTEXITCODE -ne 0) { continue }
        $d = ($raw | ConvertFrom-Json)[0]; $inspections += $d
        $envRows = @()
        foreach ($entry in $d.Config.Env) {
            $key, $value = $entry -split '=', 2
            if ($key -match '(?i)PASSWORD|SECRET|TOKEN|API_KEY|AUTH|CREDENTIAL') { continue }
            if ($key -match '^(MC_HOST|MC_PORT|MC_RCON_HOST|MC_RCON_PORT|RCON_HOST|RCON_PORT|NPC_DATA_DIR|MC_DATA_DIR|GV_BASE|MIC_BASE|ASR_MODEL_DIR|PORT)$' -and $value -match '^[a-zA-Z0-9_./:\\-]{1,200}$') { $envRows += [pscustomobject]@{key=$key;value=$value} }
            elseif ($key -match '^(TTS_LOCAL_URL|QWENPAW_CONSOLE_URL|MEMOS_API_URL|MEMOS_URL|EMBEDDING_BASE_URL|OLLAMA_BASE_URL|STT_URL)$') { $endpoint=Safe-Endpoint $value; if ($null -ne $endpoint) { $envRows += [pscustomobject]@{key=$key;endpoint=$endpoint} } }
        }
        $mountRows = @($d.Mounts | ForEach-Object { [pscustomobject]@{
            type=$_.Type;source=if ($_.Source -match '(?i)secret|credential|token') { '[credential mount path omitted]' } else { $_.Source }
            destination=if ($_.Destination -match '(?i)secret|credential|token') { '[credential mount path omitted]' } else { $_.Destination };rw=$_.RW
        } })
        $published = @(); foreach ($p in $d.NetworkSettings.Ports.PSObject.Properties) { foreach ($bind in $p.Value) { if ($null -ne $bind) { $published += [pscustomobject]@{containerPort=$p.Name;hostIp=$bind.HostIp;hostPort=$bind.HostPort} } } }
        $command = ($d.Config.Entrypoint + $d.Config.Cmd) -join ' '
        $containerRows += [pscustomobject]@{
            name=$name;id=$d.Id;image=$d.Config.Image;state=$d.State.Status;exitCode=$d.State.ExitCode;startedAt=$d.State.StartedAt;finishedAt=$d.State.FinishedAt
            healthy=$d.State.Health.Status;restartPolicy=$d.HostConfig.RestartPolicy.Name
            project=$d.Config.Labels.'com.docker.compose.project';service=$d.Config.Labels.'com.docker.compose.service'
            workingDir=$d.Config.Labels.'com.docker.compose.project.working_dir';composeFile=$d.Config.Labels.'com.docker.compose.project.config_files';dependsOn=$d.Config.Labels.'com.docker.compose.depends_on'
            mounts=$mountRows;networks=@($d.NetworkSettings.Networks.PSObject.Properties.Name);publishedPorts=$published;safeEnvironment=$envRows
            commandScripts=@([regex]::Matches($command, '(?:/app/|/opt/)[a-zA-Z0-9_./-]+\.(?:js|mjs|mts|py)')|ForEach-Object{$_.Value}|Sort-Object -Unique)
            commandEndpointTokens=@([regex]::Matches($command, '(?i)\b(?:mc|localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal)[: ]\d{2,5}\b')|ForEach-Object{$_.Value}|Sort-Object -Unique)
            rawCommandAndEnvironmentOmitted=$true
        }
    }
} catch { $dockerStatus = 'unavailable:' + $_.Exception.GetType().Name }
$coverage.docker=$dockerStatus
$candidateRows = @()
foreach ($name in @('shadow-npc','shadow-gate','shadow-voice','shadow-asr','mc-direct')) {
    $d = $inspections | Where-Object { $_.Name -eq '/' + $name } | Select-Object -First 1
    if ($null -eq $d) { continue }
    $overlaps = @()
    foreach ($m in $d.Mounts) {
        $a = Normalize-Mount $m.Source
        if (-not $a -or $a -match 'secret|token|credential') { continue }
        foreach ($other in $inspections) {
            if ($other.Id -eq $d.Id -or $other.State.Status -ne 'running') { continue }
            foreach ($om in $other.Mounts) {
                $b = Normalize-Mount $om.Source
                if ($a -eq $b -or $a.StartsWith($b + '/') -or $b.StartsWith($a + '/')) { $overlaps += [pscustomobject]@{source=$m.Source;otherContainer=$other.Name.TrimStart('/');destination=$om.Destination;otherReadWrite=$om.RW} }
            }
        }
    }
    $sample = & docker exec $name cat /proc/net/tcp /proc/net/tcp6 2>$null
    $socketOk = $LASTEXITCODE -eq 0
    $log = (& docker logs --tail 120 $name 2>&1 | Out-String)
    $candidateRows += [pscustomobject]@{
        name=$name;id=$d.Id;activeMountOverlaps=$overlaps
        hasDProjectMount=@($d.Mounts | Where-Object { (Normalize-Mount $_.Source).StartsWith('d:/projects/qiandengji/') }).Count -gt 0
        socketReadOk=$socketOk;tcpEstablished=if ($socketOk) { @($sample | Where-Object { $_ -match '^\s*\d+:\s+\S+\s+\S+\s+01\s' }).Count } else { $null }
        recentLogSampleLines=($log -split "`n").Count
        connectionFailurePatternCount=([regex]::Matches($log, '(?i)ECONNREFUSED|connection refused|Name or service not known|getaddrinfo|Temporary failure in name resolution|rcon.*err|RCON.*fail|connect.*fail')).Count
        rawLogOmitted=$true
    }
}
$queueRows = @(); foreach ($rel in @('mc\data\godvoice\text-queue','mc\data\godvoice\text-queue\.claimed','mc\data\godvoice\tts-queue','mc\data\godvoice\mic\inbox','mc\data\godvoice\mic\outbox','mc\data\godvoice\mic\processed','mcdata\spell-requests.jsonl')) { $queueRows += File-Summary (Join-Path $ShadowRoot $rel) }
$eligible = @()
$mcExited = @($containerRows | Where-Object { $_.name -eq 'shadow-mc' -and $_.state -eq 'exited' }).Count -eq 1
$supervisorCoverage = $coverage.scheduledTasks -eq 'ok' -and $coverage.services -eq 'ok' -and $coverage.startupCommand -eq 'ok' -and $nssmUnreadable -eq 0
foreach ($name in @('shadow-gate','shadow-voice','shadow-asr')) {
    $c = $containerRows | Where-Object name -eq $name | Select-Object -First 1
    $e = $candidateRows | Where-Object name -eq $name | Select-Object -First 1
    $queueSuffixes = if ($name -eq 'shadow-voice') { @('text-queue','text-queue\.claimed') } elseif ($name -eq 'shadow-asr') { @('mic\inbox') } else { @() }
    $queuesEmpty = $true
    foreach ($suffix in $queueSuffixes) {
        $q = $queueRows | Where-Object { $_.path.EndsWith('\' + $suffix) } | Select-Object -First 1
        if ($null -eq $q -or -not $q.exists -or $q.fileCount -ne 0) { $queuesEmpty = $false }
    }
    if ($mcExited -and $supervisorCoverage -and $null -ne $c -and $c.state -eq 'running' -and $c.project -eq 'shadow' -and $c.workingDir -eq $ShadowRoot -and $c.networks.Count -eq 1 -and $c.networks[0] -eq 'shadow_net' -and $e.socketReadOk -and $e.tcpEstablished -eq 0 -and -not $e.hasDProjectMount -and $queuesEmpty) { $eligible += $name }
}
$report = [ordered]@{
    schema=1;project='qiandengji';startedAt=$startedAt;generatedAt=[DateTimeOffset]::UtcNow.ToString('o');readOnly=$true
    sourceScript='tools/audit_runtime_processes.ps1';sourceSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLower()
    privacy=@{rawCommandLinesSaved=$false;rawEnvironmentSaved=$false;rawLogsSaved=$false;credentialFilesRead=$false;unrelatedApplicationsManaged=$false}
    coverage=$coverage;hostProcesses=$processRows;hostLogicalGroups=@($processRows | Group-Object logicalRole | ForEach-Object { [pscustomobject]@{role=$_.Name;processIds=@($_.Group.pid);count=$_.Count} });scheduledTasksEnumerated=$taskCount;scheduledTasks=$taskRows;windowsServices=$serviceRows;startupCommands=$startupRows;startupSourceEvidence=$sourceRows
    watchdogRetiredMarker=File-Summary (Join-Path $LegacyRoot 'ops\health\.watchdog-retired')
    containers=$containerRows;candidateEvidence=$candidateRows;legacyQueues=$queueRows
    interpretation=@{
        hostLogicalGroups=@(
            @{role='QwenPaw console';grouping='qwenpaw.exe -> venv python -> base uv python is one logical console';classification='preserve-mixed-use'},
            @{role='MCP Numen child';grouping='QwenPaw child venv python -> base uv python is one MCP subprocess';classification='needs-migration-review'},
            @{role='legacy TCP relay';grouping='venv python -> base uv python is one relay';classification='needs-supervisor-aware-migration'}
        )
        confirmedDependencyToPreserve=@{container='shadow-tts';reason='D qiandengji voice safe TTS_LOCAL_URL points at host.docker.internal:8100; legacy tts publishes 127.0.0.1:8100. Do not stop the whole shadow project.'}
        eligibleForControlledStop=$eligible
        eligibilityScope='Evidence-filtered candidates only. Named startup-source behavior was manually reviewed on 2026-09-07; changed source hashes require fresh review. Not an autonomous stop authorization.'
        conditionalConsumer='shadow-npc: MC consumer is unable to connect and no live TCP session; shared data/mcdata are still mounted by active QwenPaw/panel/gateway. Stop does not delete these files, but do not label the shared state retired.'
        hold=@('mc-direct: live host relay upstream and established connection; QwenPaw-Autostart core relaunches relay every five minutes','shadow-tts: D dependency','shadow-qwenpaw: mixed-use active console','shadow-panel: legacy 9090 retained','shadow-gateway and memory/model/STT services: active or unproven consumers')
        autostartEvidence=@(
            'QwenPaw-Autostart -> qwenpaw_autostart.bat -> hidden.vbs -> core.bat: lines17-20 relaunch only host relay25599->25566;56-61 QwenPaw console. Shared core also supervises other model and Docker Desktop: never disable it wholesale.',
            'mc_health_watchdog --auto every5min: health_mon.py306-311 immediately exits while .watchdog-retired exists; no target container start/up observed in this task.',
            'GeyserRosterDaily remains enabled: legacy roster-daily-refresh.bat uses exited shadow-mc RCON, writes legacy Geyser roster and restarts ViaProxy. It does not start candidate Docker containers.',
            'No dedicated candidate Windows service/NSSM/StartupCommand or scheduled-task Docker start/compose up was found in the inspected scope. This is bounded evidence, not a guarantee against arbitrary Agent tool use or future manual compose up.'
        )
        stopPreconditions=@('Reinspect exact ID, compose project/workdir, MC exited state and queue/socket evidence immediately before stopping.','Preserve every bind/volume and queued file. Do not run compose down or remove containers/volumes.','If a new active connection, queue input, D mount or external supervisor is found, keep the item pending.','This report authorizes no automatic stop; root coordinates the explicit bounded action.')
        limitations=@('CIM parent PID14816 was absent when first inspected; no launcher identity inferred.','A current process command line can differ from an old scheduled-task definition; task MCHostRelay-MC25565 declares25565->25599 while active core-created relay is25599->25566.','Zero Established sockets and empty input queues are point-in-time observations, not proof of no past/future users.','No arbitrary QwenPaw agent config/history or credential file was inspected; Agent-initiated starts remain outside automatic-supervisor proof.','Unrelated household/Codex/CUA processes and containers are excluded; unreadable runtime command lines are counted as unknown, not as absent services.','No network logins, gameplay actions, service mutations, filesystem cleanup or automatic migration were performed.')
    }
}
[IO.File]::WriteAllText($fullOutput, ($report | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
[pscustomobject]@{report=$fullOutput;generatedAt=$report.generatedAt;hostProcessCount=$processRows.Count;scheduledTaskCount=$taskRows.Count;containerCount=$containerRows.Count;candidateCount=$candidateRows.Count;coverage=$coverage} | ConvertTo-Json -Depth 5
