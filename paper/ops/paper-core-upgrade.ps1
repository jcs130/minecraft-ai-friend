# Offline file transaction only. Invoked by the existing maintenance task after
# its human/activity gates, normal stop, and verified complete E/F snapshots.
# It never starts Java or edits region/player data. Once 1.21.1 writes a world,
# rollback requires the entire pre-upgrade snapshot, not merely the old JAR.
function Core-SupportedStatus([string]$status) {
    # ViaBackwards answers the maintenance probe in its requested 766 protocol,
    # even when the real Paper core is 1.21.1 / 767. Keep both pinned cores valid.
    return $status -match 'Paper (1\.20\.6 \(proto 766\)|1\.21\.1 \(proto (766|767)\))'
}

function Core-ContainedPath([string]$root, [string]$relative) {
    if ([IO.Path]::IsPathRooted($relative) -or $relative -match ':|\\|(^|/)\.\.?(/|$)') { throw 'Unsafe core path' }
    $base = [IO.Path]::GetFullPath($root).TrimEnd('\')
    $target = [IO.Path]::GetFullPath((Join-Path $base $relative))
    if (-not $target.StartsWith($base + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Core path leaves root' }
    $cursor = $target
    while ($cursor.Length -ge $base.Length) {
        if ((Test-Path -LiteralPath $cursor) -and (Get-Item -LiteralPath $cursor).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw 'Core path contains a reparse point' }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
        if (-not $cursor) { break }
    }
    return $target
}

function Invoke-PaperCoreUpgrade {
    param([string]$PlanPath, [string]$ServerRoot, [string]$SourceRoot,
        [string]$LocalSnapshot, [string]$MirrorSnapshot, [scriptblock]$ServerRunning,
        [string]$YsmRoot, [scriptblock]$YsmRunning,
        [string]$NodePath='C:\Users\lzl19\AppData\Local\hermes\node\node.exe',
        [string]$YamlDependencyRoot='E:\MC\ops\yaml-check')
    if (& $ServerRunning) { throw 'Core upgrade requires a stopped server' }
    $plan = Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($plan.schema -ne 1 -or $plan.approved -ne $true -or $plan.id -notmatch '^paper-1-21-1-[a-z0-9-]{8,64}$' -or
        $plan.from -ne '1.20.6' -or $plan.to -ne '1.21.1' -or $plan.paperBuild -ne 133) { throw 'Unapproved or unsupported core upgrade plan' }
    if ([IO.Path]::GetFullPath($LocalSnapshot) -eq [IO.Path]::GetFullPath($MirrorSnapshot)) { throw 'Two separate complete snapshots required' }
    foreach ($snapshot in @($LocalSnapshot,$MirrorSnapshot)) {
        foreach ($relative in @('.complete','backup.json','server/server.jar','server/world/level.dat')) {
            if (-not (Test-Path -LiteralPath (Core-ContainedPath $snapshot $relative) -PathType Leaf)) { throw 'Complete stopped-server snapshot is missing' }
        }
        $metadata = Get-Content -LiteralPath (Join-Path $snapshot 'backup.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($metadata.stoppedForCopy -ne $true) { throw 'Snapshot was not made with the server stopped' }
    }
    $entries = @(); $seen = @{}
    foreach ($file in @($plan.files)) {
        $relative = [string]$file.target
        $proxyTarget = $relative -eq 'ysm-private/proxy/plugins/LoginGuard-0.1.2.jar'
        if ($proxyTarget -and (-not $YsmRoot -or -not $YsmRunning -or (& $YsmRunning))) { throw 'Core login update requires stopped model/login services' }
        if (-not $proxyTarget -and $relative -notmatch '^(server\.jar|cache/mojang_1\.21\.1\.jar|versions/1\.21\.1/paper-1\.21\.1\.jar|libraries/[A-Za-z0-9/._+\-]+\.jar|world/datapacks/[^/\\:]+\.zip|plugins/(AgentFriend|CortiEyeMirror|Citizens|Denizen|worldguard-bukkit|spectatorplus-paper)-[A-Za-z0-9.+_-]+\.jar)$') { throw 'Unexpected core target' }
        $source = Core-ContainedPath $SourceRoot ([string]$file.source)
        $target = if ($proxyTarget) { Core-ContainedPath $YsmRoot $relative.Substring(12) } else { Core-ContainedPath $ServerRoot $relative }
        $snapshotRelative = if ($proxyTarget) { $relative } else { 'server/' + $relative }
        $key = $target.ToLowerInvariant()
        if ($seen.ContainsKey($key)) { throw 'Duplicate core target' }; $seen[$key] = $true
        if ($file.sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $file.sha256) { throw 'Core source digest mismatch' }
        $exists = Test-Path -LiteralPath $target
        if ($file.beforeSha256) {
            if (-not $exists -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $file.beforeSha256) { throw 'Core target changed since preparation' }
            foreach ($snapshot in @($LocalSnapshot,$MirrorSnapshot)) {
                $saved = Core-ContainedPath $snapshot $snapshotRelative
                if ((Get-FileHash -LiteralPath $saved -Algorithm SHA256).Hash -ne $file.beforeSha256) { throw 'Core snapshot does not match current files' }
            }
        } elseif ($exists) { throw 'Unrecorded core file would be overwritten' }
        if (Test-Path -LiteralPath ($target + '.core-installing')) { throw 'Earlier core transaction needs inspection' }
        $entries += [pscustomobject]@{Target=$target;Relative=$relative;SnapshotRelative=$snapshotRelative;Source=$source;Hash=$file.sha256;Before=$exists;Disable=$false}
    }
    if (@($entries | Where-Object { $_.Relative -eq 'server.jar' }).Count -ne 1 -or
        ($entries | Where-Object { $_.Relative -eq 'server.jar' }).Hash -ne '39bd8c00b9e18de91dcabd3cc3dcfa5328685a53b7187a2f63280c22e2d287b9') { throw 'Pinned Paper wrapper missing' }
    foreach ($file in @($plan.disableJars)) {
        $relative = [string]$file.target
        $proxyTarget = $relative -eq 'ysm-private/proxy/plugins/LoginGuard-0.1.1.jar'
        if ($proxyTarget -and (-not $YsmRoot -or -not $YsmRunning -or (& $YsmRunning))) { throw 'Old login plugin requires stopped model/login services' }
        if (-not $proxyTarget -and $relative -notmatch '^plugins/(AgentFriend|CortiEyeMirror|Citizens|Denizen|worldguard-bukkit|spectatorplus-paper)-[A-Za-z0-9.+_-]+\.jar$') { throw 'Unexpected old core plugin' }
        $target = if ($proxyTarget) { Core-ContainedPath $YsmRoot $relative.Substring(12) } else { Core-ContainedPath $ServerRoot $relative }
        $snapshotRelative = if ($proxyTarget) { $relative } else { 'server/' + $relative }
        $key = $target.ToLowerInvariant()
        if ($seen.ContainsKey($key)) { throw 'Duplicate core target' }; $seen[$key] = $true
        if ($file.sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $file.sha256) { throw 'Old core plugin changed' }
        foreach ($snapshot in @($LocalSnapshot,$MirrorSnapshot)) {
            if ((Get-FileHash -LiteralPath (Core-ContainedPath $snapshot $snapshotRelative) -Algorithm SHA256).Hash -ne $file.sha256) { throw 'Old plugin snapshot mismatch' }
        }
        $saved = $target + '.disabled-' + $plan.id
        if (Test-Path -LiteralPath $saved) { throw 'Old plugin already saved' }
        $entries += [pscustomobject]@{Target=$target;Relative=$relative;SnapshotRelative=$snapshotRelative;Source=$saved;Hash=$file.sha256;Before=$true;Disable=$true}
    }
    $receiptRoot = Core-ContainedPath $SourceRoot ('receipts/' + $plan.id)
    if (Test-Path -LiteralPath $receiptRoot) { throw 'Core plan already attempted' }
    New-Item -ItemType Directory -Path $receiptRoot -Force | Out-Null
    $applied = New-Object System.Collections.ArrayList
    try {
        $legacyShields = 0
        if ($plan.legacyItemMigration) {
            $migration = $plan.legacyItemMigration
            if ($migration.source -ne 'operations/migrate-legacy-item-meta.mjs' -or $migration.sha256 -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Invalid legacy item migration' }
            $migrationScript = Core-ContainedPath $SourceRoot $migration.source
            if ((Get-FileHash -LiteralPath $migrationScript -Algorithm SHA256).Hash -ne $migration.sha256) { throw 'Legacy item migration source changed' }
            $dynamicRoot = Join-Path $receiptRoot 'dynamic'
            $dynamicReport = Join-Path $receiptRoot 'dynamic.json'
            & $NodePath $migrationScript --server $ServerRoot --output $dynamicRoot --report $dynamicReport --yaml-root $YamlDependencyRoot | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Legacy item migration requires inspection; no live files changed' }
            $dynamic = Get-Content -LiteralPath $dynamicReport -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($dynamic.schema -ne 1 -or $dynamic.sourceUnmodified -ne $true) { throw 'Invalid prepared legacy item data' }
            $legacyShields = $dynamic.legacyShields
            foreach ($file in @($dynamic.files)) {
                $relative = [string]$file.target
                if ($relative -notmatch '^plugins/.+\.(yml|yaml|json)$') { throw 'Unexpected legacy item data target' }
                $target = Core-ContainedPath $ServerRoot $relative
                $source = Core-ContainedPath $dynamicRoot ([string]$file.source)
                if ($seen.ContainsKey($target.ToLowerInvariant())) { throw 'Duplicate migrated core target' }
                $seen[$target.ToLowerInvariant()] = $true
                if ($file.sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or $file.beforeSha256 -notmatch '^[A-Fa-f0-9]{64}$' -or
                    (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $file.beforeSha256 -or
                    (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $file.sha256) { throw 'Legacy item data changed' }
                foreach ($snapshot in @($LocalSnapshot,$MirrorSnapshot)) {
                    if ((Get-FileHash -LiteralPath (Core-ContainedPath $snapshot ('server/' + $relative)) -Algorithm SHA256).Hash -ne $file.beforeSha256) { throw 'Legacy item snapshot mismatch' }
                }
                $entries += [pscustomobject]@{Target=$target;Relative=$relative;SnapshotRelative=('server/' + $relative);Source=$source;Hash=$file.sha256;Before=$true;Disable=$false}
            }
        }
        foreach ($entry in $entries) {
            $null = $applied.Add($entry)
            if ($entry.Disable) { Move-Item -LiteralPath $entry.Target -Destination $entry.Source; continue }
            New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($entry.Target)) -Force | Out-Null
            Copy-Item -LiteralPath $entry.Source -Destination ($entry.Target + '.core-installing')
            if ((Get-FileHash -LiteralPath ($entry.Target + '.core-installing') -Algorithm SHA256).Hash -ne $entry.Hash) { throw 'Core staged digest mismatch' }
            Move-Item -LiteralPath ($entry.Target + '.core-installing') -Destination $entry.Target -Force
            if ((Get-FileHash -LiteralPath $entry.Target -Algorithm SHA256).Hash -ne $entry.Hash) { throw 'Core installed digest mismatch' }
        }
        $receipt = [pscustomobject]@{Id=$plan.id;Files=$entries.Count;LegacyShields=$legacyShields;LocalSnapshot=$LocalSnapshot;MirrorSnapshot=$MirrorSnapshot;WorldWritten=$false;CompletedAt=(Get-Date).ToString('o')}
        $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $receiptRoot 'installed.json') -Encoding UTF8
        Move-Item -LiteralPath $PlanPath -Destination (Join-Path $receiptRoot 'consumed-plan.json')
        return $receipt
    } catch {
        $failure = $_; $rollbackErrors = @()
        for ($index = $applied.Count - 1; $index -ge 0; $index--) {
            $entry = $applied[$index]
            try {
                if ($entry.Disable) {
                    if (Test-Path -LiteralPath $entry.Source) { Move-Item -LiteralPath $entry.Source -Destination $entry.Target -Force }
                } elseif ($entry.Before) {
                    Copy-Item -LiteralPath (Core-ContainedPath $LocalSnapshot $entry.SnapshotRelative) -Destination $entry.Target -Force
                } elseif (Test-Path -LiteralPath $entry.Target) { Remove-Item -LiteralPath $entry.Target }
                if (Test-Path -LiteralPath ($entry.Target + '.core-installing')) { Remove-Item -LiteralPath ($entry.Target + '.core-installing') }
            } catch { $rollbackErrors += [string]$_ }
        }
        [pscustomobject]@{Failure=[string]$failure;RollbackErrors=$rollbackErrors;WorldWritten=$false} |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $receiptRoot 'failed.json') -Encoding UTF8
        if ($rollbackErrors.Count) {
            $blocked = New-Object InvalidOperationException 'Core file rollback incomplete; keep automatic startup paused and inspect receipt'
            $blocked.Data['CoreRecoveryBlocked'] = $true
            throw $blocked
        }
        throw $failure
    }
}

function Deploy-PendingPaperCore([string]$localSnapshot, [string]$mirrorSnapshot) {
    $planPath = Join-Path $opsDir 'paper-core-upgrade.pending.json'
    if (-not (Test-Path -LiteralPath $planPath)) { return }
    foreach ($name in @('content-plugins.pending.json','agentfriend-deploy.pending.json','cortieye-deploy.pending.json','geyser-deploy.pending.json','server-settings.pending.json')) {
        if (Test-Path -LiteralPath (Join-Path $opsDir $name)) { throw 'Finish or withdraw other pending deployments before a core upgrade' }
    }
    try {
        $null = Content-YsmProxyTarget 'LoginGuard-0.1.2.jar'
        $receipt = Invoke-PaperCoreUpgrade -PlanPath $planPath -ServerRoot $serverDir -SourceRoot 'E:\MC\releases\paper-1.21.1-20261015' -LocalSnapshot $localSnapshot -MirrorSnapshot $mirrorSnapshot -ServerRunning { [bool](Listener) } -YsmRoot (Ysm-Config).root -YsmRunning {
            $config = Ysm-Config
            foreach ($port in @($config.controlPort,$config.proxy.port,$config.worker.port,$config.workerControllerPort)) {
                if (Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { return $true }
            }
            return $false
        }
    } catch {
        if ($_.Exception.Data['CoreRecoveryBlocked']) { $script:coreUpgradeRecoveryBlocked = $true }
        if (Test-Path -LiteralPath $planPath) {
            Move-Item -LiteralPath $planPath -Destination (Join-Path $opsDir ('paper-core-upgrade.failed-' + [guid]::NewGuid().ToString('N') + '.json'))
        }
        throw
    }
    Log "Paper core files installed after complete E/F backup: $($receipt.Id), $($receipt.Files) entries; world upgrade occurs at normal startup"
}
