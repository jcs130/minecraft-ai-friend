# Loaded by manage-server.ps1. This is executed only after both stopped snapshots.
function Content-YsmProxyTarget([string]$name) {
    if ($name -notmatch '^(AgentAppearance|LibreLogin|LoginGuard|NanoLimboPlugin-velocity)-[0-9]+\.[0-9]+\.[0-9]+\.jar$') { throw 'Unexpected proxy plugin JAR' }
    $config = Ysm-Config
    if (-not $config -or -not $config.enabled) { throw 'YSM bridge deployment requires the existing enabled lifecycle' }
    foreach ($port in @($config.controlPort,$config.proxy.port,$config.worker.port,$config.workerControllerPort)) {
        if (Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
            throw 'YSM bridge deployment requires stopped Proxy and Worker'
        }
    }
    return (Join-Path $config.root ("proxy/plugins/" + $name))
}

function Content-AuthTarget([string]$relative) {
    # Reuse the stopped service gate for every login config/database/library.
    $null = Content-YsmProxyTarget 'LoginGuard-0.1.0.jar'
    $config = Ysm-Config
    if ($relative -eq 'ysm-auth/velocity.toml') { return (Join-Path $config.root 'proxy/velocity.toml') }
    $path = $relative.Substring(9)
    if ($path -notmatch '^(librelogin/(config\.conf|messages\.conf|user-data\.db|forbidden-passwords\.txt)|login-guard/config\.properties|nanolimbovelocity/(config\.yml|auth/settings\.yml)|librelogin/lib/[A-Za-z0-9/._+-]+\.jar)$' -or $path -match '(^|/)\.\.(/|$)') { throw 'Unexpected authentication target' }
    return (Join-Path $config.root ('proxy/plugins/' + $path))
}

function Deploy-PendingContent {
    $planPath = Join-Path $opsDir 'content-plugins.pending.json'
    if (-not (Test-Path -LiteralPath $planPath)) { return }
    if (Listener) { throw 'Content deployment requires stopped Paper' }
    # Scheduled Windows PowerShell uses the machine ANSI code page. Release
    # notes are UTF-8, including Chinese punctuation next to JSON quotes.
    $plan = Get-Content -LiteralPath $planPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($plan.schema -ne 1 -or $plan.id -notmatch '^[a-z0-9-]{8,80}$') { throw 'Invalid content deployment plan' }
    $allowed = @('AgentFriend','BetonQuest','FancyNpcs','Citizens','Denizen','ConditionalEvents','WorldEvents','MythicMobs','Shopkeepers','NPCSpeak','ImageFrame','FancyAnalytics')
    $entries = @(); $seen = @{}
    foreach ($file in @($plan.files)) {
        $relative = [string]$file.target
        if ($relative -match '^[A-Za-z0-9][A-Za-z0-9_.-]*\.jar$') {
            if ($relative -notmatch '^(AgentFriend|CortiEyeMirror|BetonQuest|FancyNpcs|Citizens|Denizen|ConditionalEvents|WorldEvents|MythicMobs|Shopkeepers|NPCSpeak|ImageFrame)-') { throw 'Unexpected plugin JAR' }
            $target = Join-Path (Join-Path $serverDir 'plugins') $relative
        } elseif ($relative -match '^ysm-proxy/((AgentAppearance|LibreLogin|LoginGuard|NanoLimboPlugin-velocity)-[0-9]+\.[0-9]+\.[0-9]+\.jar)$') {
            $target = Content-YsmProxyTarget $Matches[1]
        } elseif ($relative -match '^ysm-model/(cormy|neko_yui)/ysm\.json$') {
            $modelId = $Matches[1]
            # These two approved size corrections share the stopped services,
            # complete E/F backup, digest and atomic rollback gates above.
            $null = Content-YsmProxyTarget 'AgentAppearance-0.3.2.jar'
            $target = Join-Path (Ysm-Config).root ("worker/config/yes_steve_model/custom/$modelId/ysm.json")
        } elseif ($relative.StartsWith('ysm-auth/')) {
            $target = Content-AuthTarget $relative
        } elseif ($relative -match '^ops/auth-credentials/[A-Za-z0-9_]{1,16}\.env$') {
            $null = Content-YsmProxyTarget 'LoginGuard-0.1.0.jar'
            $target = Join-Path $opsDir $relative.Substring(4)
        } elseif ($relative -eq 'libraries/org/slf4j/slf4j-api/1.7.36/slf4j-api-1.7.36.jar') {
            $target = Join-Path $serverDir $relative
        } elseif ($relative -eq 'commands.yml') {
            # Explicit server aliases resolve Minepacks/BetonQuest's backpack collision.
            # This one root file uses the same stopped E/F snapshots, pinned hashes,
            # atomic replacement and rollback as plugin configuration below.
            $target = Join-Path $serverDir $relative
        } elseif ($relative -in @('plugins/CortiEyeMirror/config.yml','plugins/WorldGuard/worlds/world/regions.yml','plugins/MagicSpells/general.yml','plugins/MagicSpells/spells-agentfriend.yml','plugins/SpectatorPlus/config.yml','plugins/Geyser-Spigot/extensions/ysmbedrock/config.json','plugins/Geyser-Spigot/extensions/AgentAppearance-Bedrock-0.1.0.jar','plugins/Freesia-Backend-2.5.1+2.4.1-all.jar')) {
            # Only the two server-owned spell files are eligible; the same
            # pinned hashes, stopped snapshots and rollback apply below.
            $target = Join-Path $serverDir $relative
        } elseif ($relative -in @('plugins/Geyser-Spigot/packs/qiandengji-items-bedrock.mcpack','plugins/Geyser-Spigot/custom_mappings/qiandengji-items.geyser.json')) {
            # Only this authored item pack and its exact mapping can be deployed.
            # Preserve stopped-server, dual-snapshot, digest and rollback gates.
            $target = Join-Path $serverDir $relative
        } elseif ($relative -match '^plugins/([A-Za-z0-9]+)/(.+)$' -and $allowed -contains $Matches[1]) {
            if ($relative -match '(^|/)\.\.(/|$)|:|\\' -or $relative -notmatch '\.(yml|yaml|json|dsc)$') { throw 'Unsafe plugin configuration path' }
            $target = Join-Path $serverDir $relative
        } elseif ($relative -in @('ops/agent-auth.json','ops/auth-proxy.mjs','ops/mineflayer-login-gate.mjs','ops/mineflayer-client-compat.mjs','ops/manage-server.ps1','ops/content-deploy.ps1','ops/ysm-services.mjs','ops/ysm-services.json','ops/goddess-bridge.mjs','ops/goddess-photo-camera.mjs','ops/goddess-photo-camera.json','ops/goddess-mcp.py','ops/goddess-perception.mjs','ops/maintenance-notice.mjs','ops/npc-dialogue-adapter.mjs','ops/npc-adapter.private.json','ops/agent-eye-names.mjs','ops/agent-eye-pairs.json','ops/agent-eye-watcher.mjs','ops/agent-lan-gateway.mjs','ops/agent-gateway-access.json')) {
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
        if ($file.name -match '^ysm-proxy/((?:AgentAppearance|LoginGuard)-[0-9]+\.[0-9]+\.[0-9]+\.jar)$') {
            $target = Content-YsmProxyTarget $Matches[1]
        } elseif ($file.name -match '^(AgentFriend|CortiEyeMirror)-[0-9]+\.[0-9]+\.[0-9]+\.jar$') {
            $target = Join-Path (Join-Path $serverDir 'plugins') $file.name
        } else { throw 'Only previous first-party plugin JAR may be removed' }
        if ($seen.ContainsKey($target.ToLowerInvariant())) { throw 'Duplicate content target' }
        $seen[$target.ToLowerInvariant()] = $true
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
        # Windows PowerShell 5 Select-Object reads the hashtable's CLR properties,
        # not its keys. Emit actual recovery paths rather than null journal rows.
        $entries | ForEach-Object { [pscustomobject]@{Target=$_.Target;Hash=$_.Hash;Before=$_.Before;Backup=$_.Backup} } |
            ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $rollback 'applied.json') -Encoding UTF8
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
