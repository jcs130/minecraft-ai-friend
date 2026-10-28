# Loaded by manage-server.ps1. This is executed only after both stopped snapshots.
function Content-FirstPartyPreviousJar([string]$name) {
    # Deployed hotfixes such as 0.4.47.3 use a fourth numeric component.
    # Keep the first-party filename boundary; deployment still pins its SHA256.
    return $name -match '^(AgentFriend|CortiEyeMirror)-[0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?\.jar$'
}

function Content-NumenPaperJar([string]$name) {
    # Reviewed Paper artifacts from the pinned upstream build. Fabric/NeoForge
    # releases are not interchangeable with these two plugins.
    return $name -cmatch '^(?:numen(?:_api)?-paper-1\.21\.1-0\.1\.4|NumenBedrock-0\.1\.0)\.jar$'
}

function Content-McbotJar([string]$name) {
    return $name -ceq 'QiandengjiMcbot-0.1.0.jar'
}

function Content-ProximityVoiceJar([string]$name) {
    return $name -cin @('voicechat-bukkit-2.6.27.jar','QiandengVoice-0.1.0.jar')
}

function Content-ProximityVoiceTarget([string]$relative) {
    return (Content-ProximityVoiceJar $relative) -or $relative -cin @(
        'plugins/QiandengVoice/config.yml','plugins/QiandengVoice/bridge.token',
        'plugins/voicechat/voicechat-server.properties')
}

function Content-AgentVisionJar([string]$name) {
    return $name -ceq 'AgentVision-0.1.0.jar' -or $name -ceq 'AgentVision-0.1.1.jar' -or $name -ceq 'AgentVision-0.1.2.jar'
}

function Content-AincradProtectionTarget([string]$relative) {
    # Only the reviewed authored world's two protection files. Do not broaden
    # this to arbitrary WorldGuard configuration or player-owned regions.
    return $relative -ceq 'plugins/WorldGuard/worlds/aincrad/regions.yml' -or
        $relative -ceq 'plugins/WorldGuard/worlds/aincrad/config.yml'
}

function Content-ConquestScoreboardTarget([string]$relative) {
    # One pinned sidebar provider and its reviewed config, not arbitrary TAB
    # plugins/configuration. The same stopped server and digest gates apply.
    return $relative -ceq 'TAB-6.2.1-Paper-1.20.5-1.21.4.jar' -or
        $relative -ceq 'plugins/TAB/config.yml'
}

function Content-AgentAntiCheatJar([string]$relative) {
    return $relative -ceq 'LightAntiCheat-1.2.6-qd1.jar' -or $relative -ceq 'QiandengjiAntiCheat-0.1.0.jar'
}

function Content-AgentAntiCheatTarget([string]$relative) {
    # Reviewed artifacts and one config only; no other files or player data.
    return (Content-AgentAntiCheatJar $relative) -or $relative -ceq 'plugins/LightAntiCheat/config.yml'
}

function Content-MultiverseJar([string]$relative) {
    return $relative -ceq 'Multiverse-Core-5.8.1.jar'
}

function Content-MultiverseTarget([string]$relative) {
    # Exact reviewed core and configuration only; never inventories or worlds.
    return (Content-MultiverseJar $relative) -or $relative -ceq 'plugins/Multiverse-Core/config.yml'
}

function Content-NativeRpgJar([string]$relative) {
    return $relative -cin @('VortexRPG-1.2.2-alpha-qd27-zh.jar','VortexRPG-1.2.2-alpha-qd29.jar','QiandengjiRpg-0.2.0.jar','QiandengjiRpg-0.2.4.jar','QiandengjiRpg-0.2.6.jar','Vault-1.7.3.jar')
}

function Content-NativeRpgTarget([string]$relative) {
    # Exact static configuration only. Never native player/quest/talent stores.
    return (Content-NativeRpgJar $relative) -or $relative -cin @(
        'plugins/VortexRPG/config.yml','plugins/VortexRPG/quests.yml',
        'plugins/VortexRPG/spells.yml','plugins/VortexRPG/effects.yml',
        'plugins/VortexRPG/items.yml','plugins/VortexRPG/talents.yml',
        'plugins/VortexRPG/bosses.yml','plugins/VortexRPG/dungeons.yml',
        'plugins/QiandengjiRpg/config.yml','plugins/QiandengjiRpg/city-facilities.yml',
        'plugins/AuraSkills/config.yml','plugins/AuraSkills/abilities.yml',
        'plugins/AuraSkills/mana_abilities.yml','plugins/AuraSkills/stats.yml',
        'plugins/AuraSkills/skills.yml')
}

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

function Content-KiritoAppearanceTarget([string]$relative) {
    # Only this reviewed model and its server-owned bridge config are eligible.
    # Reuse the existing stopped Proxy/Worker gate and subsequent E/F snapshot/hash checks.
    $null = Content-YsmProxyTarget 'AgentAppearance-0.3.3.jar'
    $config = Ysm-Config
    if ($relative -ceq 'ysm-appearance/models.json') {
        return (Join-Path $config.root 'proxy/plugins/agentappearance/models.json')
    }
    if ($relative -cmatch '^ysm-model/qiandengji_kirito/(?<asset>ysm\.json|models/(?:main|arm)\.json|animations/(?:main|tac)\.animation\.json|textures/skin\.png|avatar/(?:dm|gsl|tzz)\.png|lang/(?:zh_cn|en_us)\.json|CREDITS\.txt|\.qiandengji-generated\.json)$') {
        return (Join-Path $config.root ('worker/config/yes_steve_model/custom/qiandengji_kirito/' + $Matches['asset']))
    }
    throw 'Unexpected Kirito appearance target'
}

function Deploy-PendingContent([string]$coldBackup='', [string]$mirrorBackup='') {
    $planPath = Join-Path $opsDir 'content-plugins.pending.json'
    if (-not (Test-Path -LiteralPath $planPath)) { return }
    if (Listener) { throw 'Content deployment requires stopped Paper' }
    # Scheduled Windows PowerShell uses the machine ANSI code page. Release
    # notes are UTF-8, including Chinese punctuation next to JSON quotes.
    $plan = Get-Content -LiteralPath $planPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($plan.schema -ne 1 -or $plan.id -notmatch '^[a-z0-9-]{8,80}$') { throw 'Invalid content deployment plan' }
    $voiceChange = @($plan.files | Where-Object { Content-ProximityVoiceTarget ([string]$_.target) }).Count -gt 0 -or
        @($plan.removeJars | Where-Object { Content-ProximityVoiceJar ([string]$_.name) }).Count -gt 0
    if ($voiceChange -and (-not $coldBackup -or -not $mirrorBackup -or
        -not (Test-Path -LiteralPath (Join-Path $coldBackup '.complete')) -or
        -not (Test-Path -LiteralPath (Join-Path $mirrorBackup '.complete')))) {
        throw 'Voice deployment requires both complete cold backups'
    }
    $moneyHelper = Join-Path $opsDir 'rpg-economy-migration.py'
    if ($plan.unifyEconomy) {
        if ($plan.id -cne 'rpg-unified-release-20261028-r1' -or -not $coldBackup -or -not $mirrorBackup -or
            $plan.unifyEconomy.helperSha256 -notmatch '^[A-Fa-f0-9]{64}$' -or
            (Get-FileHash -LiteralPath $moneyHelper -Algorithm SHA256).Hash -ne $plan.unifyEconomy.helperSha256) {
            throw 'Unreviewed economy migration or missing complete cold backups'
        }
    }
    $allowed = @('AgentFriend','BetonQuest','FancyNpcs','Citizens','Denizen','ConditionalEvents','WorldEvents','MythicMobs','Shopkeepers','NPCSpeak','ImageFrame','FancyAnalytics','WorldVariety','VillagerLife','Sentinel','OlEncounters','CommandAPI','FastAsyncWorldEdit')
    $worldVarietyPacks = @('more-chinese-structures','chinese-village','zhengsz-wonderland','aoe4mc','japanese-castle','castles-castles','grim-kingdoms-lost-structures-ruins','caleari-castle','ati-structures-vanilla-edition','towns-and-towers','ct-overhaul-village','lukis-grand-capitals','adorabuild-structures','dungeons-and-taverns-end-castle-standalone','hopo-better-ruined-portals','hopo-better-underwater-ruins','moogs-voyager-structures','when-dungeons-arise','when-dungeons-arise-seven-seas','sky-villages','peakscape','mss-moogs-soaring-structures','mes-moogs-end-structures','mmv-moogs-missing-villages','mtr-moogs-temples-reimagined','hopo-better-mineshaft')
    $entries = @(); $seen = @{}
    foreach ($file in @($plan.files)) {
        $relative = [string]$file.target
        if ($relative -match '^[A-Za-z0-9][A-Za-z0-9_.-]*\.jar$') {
            if ($relative -notmatch '^(AgentFriend|CortiEyeMirror|BetonQuest|FancyNpcs|Citizens|Denizen|ConditionalEvents|WorldEvents|MythicMobs|Shopkeepers|NPCSpeak|ImageFrame|WorldVariety|VillagerLife|Sentinel|OlEncounters|CommandAPI|FastAsyncWorldEdit|WorldObserver)-' -and -not (Content-NumenPaperJar $relative) -and -not (Content-AgentVisionJar $relative) -and -not (Content-ConquestScoreboardTarget $relative) -and -not (Content-AgentAntiCheatTarget $relative) -and -not (Content-MultiverseJar $relative) -and -not (Content-NativeRpgJar $relative) -and -not (Content-McbotJar $relative) -and -not (Content-ProximityVoiceJar $relative)) { throw 'Unexpected plugin JAR' }
            $target = Join-Path (Join-Path $serverDir 'plugins') $relative
        } elseif ($relative -match '^world/datapacks/(world-expansion--(?<slug>[a-z0-9-]+)|zz-qiandengji-world-variety)\.zip$') {
            if ($Matches['slug'] -and $worldVarietyPacks -notcontains $Matches['slug']) { throw 'Unreviewed world variety pack' }
            $target = Join-Path $serverDir $relative
        } elseif ((Content-AincradProtectionTarget $relative) -or (Content-ConquestScoreboardTarget $relative) -or (Content-AgentAntiCheatTarget $relative) -or (Content-MultiverseTarget $relative) -or (Content-NativeRpgTarget $relative) -or (Content-ProximityVoiceTarget $relative)) {
            $target = Join-Path $serverDir $relative
        } elseif ($relative -eq 'plugins/OlEncounters/schematics/qd_forest_camp.schem') {
            $target = Join-Path $serverDir $relative
        } elseif ($relative -match '^ysm-proxy/((AgentAppearance|LibreLogin|LoginGuard|NanoLimboPlugin-velocity)-[0-9]+\.[0-9]+\.[0-9]+\.jar)$') {
            $target = Content-YsmProxyTarget $Matches[1]
        } elseif ($relative -eq 'ysm-appearance/models.json' -or $relative.StartsWith('ysm-model/qiandengji_kirito/')) {
            $target = Content-KiritoAppearanceTarget $relative
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
        } elseif ($relative -ceq 'ops.json' -and $plan.id -ceq 'basic-survival-release-20261028') {
            # Owner explicitly requested OP on the existing live observer. This
            # single release cannot change any other operator or UUID.
            $target = Join-Path $serverDir 'ops.json'
            $previousOps = Get-Content -LiteralPath $target -Raw -Encoding UTF8 | ConvertFrom-Json
            $nextOps = Get-Content -LiteralPath $file.source -Raw -Encoding UTF8 | ConvertFrom-Json
            $liveUuid = '4e620aee-9f79-368f-9919-34e608edf0c3'
            $beforeOther = @($previousOps | Where-Object { $_.uuid -cne $liveUuid }) | ConvertTo-Json -Depth 8 -Compress
            $afterOther = @($nextOps | Where-Object { $_.uuid -cne $liveUuid }) | ConvertTo-Json -Depth 8 -Compress
            $liveOps = @($nextOps | Where-Object { $_.uuid -ceq $liveUuid })
            if ($beforeOther -cne $afterOther -or $liveOps.Count -ne 1 -or
                $liveOps[0].name -cne 'live' -or $liveOps[0].level -ne 4 -or
                $liveOps[0].bypassesPlayerLimit -ne $false) { throw 'Only the approved live operator may change' }
        } elseif ($relative -eq 'commands.yml') {
            # Explicit server aliases resolve Minepacks/BetonQuest's backpack collision.
            # This one root file uses the same stopped E/F snapshots, pinned hashes,
            # atomic replacement and rollback as plugin configuration below.
            $target = Join-Path $serverDir $relative
        } elseif ($relative -in @('plugins/WorldObserver/config.yml','plugins/CortiEyeMirror/config.yml','plugins/WorldGuard/worlds/world/regions.yml','plugins/MagicSpells/general.yml','plugins/MagicSpells/spells-agentfriend.yml','plugins/SpectatorPlus/config.yml','plugins/Geyser-Spigot/extensions/ysmbedrock/config.json','plugins/Geyser-Spigot/extensions/AgentAppearance-Bedrock-0.1.0.jar','plugins/Freesia-Backend-2.5.1+2.4.1-all.jar','plugins/numen/server/server.json','plugins/numen/server/mcp_server.json','plugins/numen/server/appearance_bindings.json')) {
            # Only the two server-owned spell files are eligible; the same
            # pinned hashes, stopped snapshots and rollback apply below.
            $target = Join-Path $serverDir $relative
        } elseif ($relative -in @('plugins/Geyser-Spigot/packs/qiandengji-items-bedrock.mcpack','plugins/Geyser-Spigot/custom_mappings/qiandengji-items.geyser.json')) {
            # Only this authored item pack and its exact mapping can be deployed.
            # Preserve stopped-server, dual-snapshot, digest and rollback gates.
            $target = Join-Path $serverDir $relative
        } elseif ($relative -eq 'ops/photo-image-quality.mjs' -or $relative -eq 'ops/native-photo-renderer.mjs') {
            # Pure screenshot metrics imported by the existing local camera.
            # Same stopped-server, E/F backup and pinned-hash gates as the worker.
            $target = Join-Path $opsDir $relative.Substring(4)
        } elseif ($relative -match '^plugins/([A-Za-z0-9]+)/(.+)$' -and $allowed -contains $Matches[1]) {
            if ($relative -match '(^|/)\.\.(/|$)|:|\\' -or $relative -notmatch '\.(yml|yaml|json|dsc)$') { throw 'Unsafe plugin configuration path' }
            $target = Join-Path $serverDir $relative
        } elseif ($relative -in @('ops/agent-client-identity.ps1','ops/maintenance-identities.private.json')) {
            $target = Join-Path $opsDir $relative.Substring(4)
        } elseif ($relative -in @('ops/agent-auth.json','ops/auth-proxy.mjs','ops/mineflayer-login-gate.mjs','ops/mineflayer-client-compat.mjs','ops/manage-server.ps1','ops/content-deploy.ps1','ops/numen-qwenpaw-controller.py','ops/ysm-services.mjs','ops/ysm-services.json','ops/goddess-bridge.mjs','ops/goddess-photo-camera.mjs','ops/goddess-photo-camera.json','ops/goddess-mcp.py','ops/goddess-perception.mjs','ops/maintenance-notice.mjs','ops/npc-dialogue-adapter.mjs','ops/npc-adapter.private.json','ops/agent-eye-names.mjs','ops/agent-eye-pairs.json','ops/agent-eye-watcher.mjs','ops/agent-lan-gateway.mjs','ops/agent-gateway-access.json')) {
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
        } elseif ((Content-FirstPartyPreviousJar $file.name) -or (Content-AgentVisionJar $file.name) -or (Content-AgentAntiCheatJar $file.name) -or (Content-MultiverseJar $file.name) -or (Content-NativeRpgJar $file.name) -or (Content-ProximityVoiceJar $file.name)) {
            $target = Join-Path (Join-Path $serverDir 'plugins') $file.name
        } elseif ($file.name -eq 'worldedit-bukkit-7.3.9.jar') {
            # This exact reviewed replacement is necessary: FAWE provides the
            # WorldEdit API and may not run alongside the old WorldEdit JAR.
            # Preserve its digest, stopped backup and atomic rollback gates.
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
    $applied = @(); $index = 0; $moneyApplied = $false
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
        if ($plan.unifyEconomy) {
            $moneyResult = & 'E:/MC/runtime/python-3.12.14/python.exe' -X utf8 $moneyHelper apply --release $plan.id --backup $coldBackup --mirror $mirrorBackup
            if ($LASTEXITCODE -ne 0) { throw 'Cold native economy migration failed; inspect private evidence' }
            $moneyApplied = $true
            Log ('Native gold migration: ' + ($moneyResult -join ' '))
        }
        # Windows PowerShell 5 Select-Object reads the hashtable's CLR properties,
        # not its keys. Emit actual recovery paths rather than null journal rows.
        $entries | ForEach-Object { [pscustomobject]@{Target=$_.Target;Hash=$_.Hash;Before=$_.Before;Backup=$_.Backup} } |
            ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $rollback 'applied.json') -Encoding UTF8
        Move-Item -LiteralPath $planPath -Destination (Join-Path $rollback 'consumed-plan.json')
        Log "Content plugins deployed: $($plan.id), $($entries.Count) verified files"
    } catch {
        $failure = $_
        if ($moneyApplied) {
            & 'E:/MC/runtime/python-3.12.14/python.exe' -X utf8 $moneyHelper rollback --release $plan.id --backup $coldBackup --mirror $mirrorBackup | Out-Null
            if ($LASTEXITCODE -ne 0) { $script:contentRecoveryBlocked = $true; Log 'CRITICAL: native economy rollback incomplete' }
        }
        if (Test-Path -LiteralPath (Join-Path $opsDir 'rpg-economy-recovery.blocked')) { $script:contentRecoveryBlocked = $true }
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
