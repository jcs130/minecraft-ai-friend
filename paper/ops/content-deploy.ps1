# Loaded by manage-server.ps1. This is executed only after both stopped snapshots.
function Deploy-PendingContent {
    $planPath = Join-Path $opsDir 'content-plugins.pending.json'
    if (-not (Test-Path -LiteralPath $planPath)) { return }
    if (Listener) { throw 'Content deployment requires stopped Paper' }
    $plan = Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
    if ($plan.schema -ne 1 -or $plan.id -notmatch '^[a-z0-9-]{8,80}$') { throw 'Invalid content deployment plan' }
    $allowed = @('AgentFriend','BetonQuest','FancyNpcs','Citizens','Denizen','ConditionalEvents','WorldEvents','MythicMobs','Shopkeepers','NPCSpeak','ImageFrame','FancyAnalytics')
    $entries = @(); $seen = @{}
    foreach ($file in @($plan.files)) {
        $relative = [string]$file.target
        if ($relative -match '^[A-Za-z0-9][A-Za-z0-9_.-]*\.jar$') {
            if ($relative -notmatch '^(AgentFriend|BetonQuest|FancyNpcs|Citizens|Denizen|ConditionalEvents|WorldEvents|MythicMobs|Shopkeepers|NPCSpeak|ImageFrame)-') { throw 'Unexpected plugin JAR' }
            $target = Join-Path (Join-Path $serverDir 'plugins') $relative
        } elseif ($relative -eq 'libraries/org/slf4j/slf4j-api/1.7.36/slf4j-api-1.7.36.jar') {
            $target = Join-Path $serverDir $relative
        } elseif ($relative -in @('plugins/MagicSpells/general.yml','plugins/MagicSpells/spells-agentfriend.yml')) {
            # Only the two server-owned spell files are eligible; the same
            # pinned hashes, stopped snapshots and rollback apply below.
            $target = Join-Path $serverDir $relative
        } elseif ($relative -match '^plugins/([A-Za-z0-9]+)/(.+)$' -and $allowed -contains $Matches[1]) {
            if ($relative -match '(^|/)\.\.(/|$)|:|\\' -or $relative -notmatch '\.(yml|yaml|json|dsc)$') { throw 'Unsafe plugin configuration path' }
            $target = Join-Path $serverDir $relative
        } elseif ($relative -in @('ops/goddess-bridge.mjs','ops/goddess-mcp.py','ops/maintenance-notice.mjs','ops/npc-dialogue-adapter.mjs','ops/npc-adapter.private.json')) {
            $target = Join-Path $opsDir $relative.Substring(4)
        } else { throw "Unexpected content target: $relative" }
        $source = [IO.Path]::GetFullPath([string]$file.source)
        if (-not $source.StartsWith('E:\MC\ops\repairs\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Content source must be staged in repairs' }
        if ($seen.ContainsKey($target.ToLowerInvariant())) { throw 'Duplicate content target' }
        $seen[$target.ToLowerInvariant()] = $true
        if ($file.sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $file.sha256) { throw "Content source hash mismatch: $relative" }
        if ($file.beforeSha256) {
            if (-not (Test-Path -LiteralPath $target) -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $file.beforeSha256) { throw "Content target changed: $relative" }
        } elseif (Test-Path -LiteralPath $target) { throw "Content would overwrite an unrecorded file: $relative" }
        $entries += @{Source=$source;Target=$target;Hash=$file.sha256;Before=[bool]$file.beforeSha256}
    }
    foreach ($file in @($plan.removeJars)) {
        if ($file.name -notmatch '^AgentFriend-[0-9.]+\.jar$') { throw 'Only previous AgentFriend JAR may be removed' }
        $target = Join-Path (Join-Path $serverDir 'plugins') $file.name
        if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $file.sha256) { throw 'Previous AgentFriend changed' }
        $entries += @{Source=$null;Target=$target;Before=$true}
    }
    $rollback = Join-Path $opsDir "repairs\$($plan.id)\deployment-rollback"
    if (Test-Path -LiteralPath $rollback) { throw 'Content rollback directory already exists' }
    New-Item -ItemType Directory -Path $rollback | Out-Null
    $applied = @(); $index = 0
    try {
        foreach ($entry in $entries) {
            $entry.Backup = Join-Path $rollback "$index.original"
            if ($entry.Before) { Copy-Item -LiteralPath $entry.Target -Destination $entry.Backup }
            if ($entry.Source) {
                New-Item -ItemType Directory -Path (Split-Path -Parent $entry.Target) -Force | Out-Null
                $temp = $entry.Target + '.installing'
                Copy-Item -LiteralPath $entry.Source -Destination $temp
                if ((Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash -ne $entry.Hash) { throw 'Content copy hash mismatch' }
                # Windows PowerShell coerces $null to an empty string for this
                # framework overload. Use an explicit recovery path instead.
                if ($entry.Before) { [IO.File]::Replace($temp, $entry.Target, ($entry.Backup + '.replace-original')) }
                else { Move-Item -LiteralPath $temp -Destination $entry.Target }
            } else { Remove-Item -LiteralPath $entry.Target }
            $applied += $entry
            $index++
        }
        $entries | Select-Object Target,Hash,Before,Backup | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $rollback 'applied.json') -Encoding UTF8
        Move-Item -LiteralPath $planPath -Destination (Join-Path $rollback 'consumed-plan.json')
        Log "Content plugins deployed: $($plan.id), $($entries.Count) verified files"
    } catch {
        $failure = $_
        [array]::Reverse($applied)
        foreach ($entry in $applied) {
            try {
                if ($entry.Before) { Copy-Item -LiteralPath $entry.Backup -Destination $entry.Target -Force }
                elseif (Test-Path -LiteralPath $entry.Target) { Remove-Item -LiteralPath $entry.Target }
            } catch { Log "CRITICAL content rollback: $($entry.Target): $_" }
        }
        foreach ($entry in $entries) {
            $temp = $entry.Target + '.installing'
            if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
        }
        throw $failure
    }
}
