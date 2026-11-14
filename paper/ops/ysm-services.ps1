# Loaded by the existing manage-server lock. No separate scheduled job.
function Ysm-Config {
    $file = Join-Path $opsDir 'ysm-services.json'
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    $c = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($c.schemaVersion -ne 1 -or $c.controlPort -lt 1024 -or $c.controlPort -gt 65535) { throw 'Invalid YSM lifecycle configuration' }
    return $c
}
function Ysm-Control([string]$action) {
    $output = & $node (Join-Path $opsDir 'ysm-services-control.mjs') $action 2>&1
    if ($LASTEXITCODE -ne 0) { throw "YSM control $action failed: $($output -join ' ')" }
    return (($output -join "`n") | ConvertFrom-Json)
}
function Ysm-ChildPorts($c) {
    $ports=@($c.proxy.port)
    if ($c.PSObject.Properties.Name -contains 'worker' -and $null -ne $c.worker) { $ports+=@($c.worker.port) }
    if ($c.PSObject.Properties.Name -contains 'workerControllerPort') { $ports+=@($c.workerControllerPort) }
    if ($c.PSObject.Properties.Name -contains 'auth' -and $null -ne $c.auth) { $ports+=@($c.auth.port,$c.auth.rconPort) }
    return $ports
}
function Start-YsmServices {
    $c = Ysm-Config
    if (-not $c -or -not $c.enabled) { return }
    $listeners = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $c.controlPort -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 1) { throw 'Multiple YSM lifecycle listeners' }
    if ($listeners.Count -eq 0) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $proc = Start-IndependentProcess -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $opsDir 'ysm-services-launch.ps1'),'-Config',(Join-Path $opsDir 'ysm-services.json')) -WorkingDirectory $opsDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $opsDir "ysm-services-$stamp.log") -RedirectStandardError (Join-Path $opsDir "ysm-services-$stamp.error.log") -PassThru
        Log "YSM supervisor launched PID=$($proc.Id)"
    }
    $hasNativeAuth=$c.PSObject.Properties.Name -contains 'auth' -and $null -ne $c.auth
    $deadline = (Get-Date).AddSeconds($(if($hasNativeAuth){180}else{60}))
    do {
        $listeners = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $c.controlPort -State Listen -ErrorAction SilentlyContinue)
        if ($listeners.Count -eq 1) {
            $state = Ysm-Control 'status'
            if ($state.protocol -ne 'YSM-SERVICES-V1' -or $state.pid -ne $listeners[0].OwningProcess) { throw 'YSM supervisor identity mismatch' }
            $proxy = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $c.proxy.port -State Listen -ErrorAction SilentlyContinue)
            $authReady=$true
            if($hasNativeAuth){
                $auth=@(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $c.auth.port -State Listen -ErrorAction SilentlyContinue)
                $authReady=$state.services.auth.alive -and $auth.Count -eq 1 -and $auth[0].OwningProcess -eq $state.services.auth.pid
            }
            if ($authReady -and $state.services.proxy.alive -and $proxy.Count -eq 1 -and $proxy[0].OwningProcess -eq $state.services.proxy.pid) { return }
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw 'YSM proxy did not become ready; existing backend routing has not been bypassed'
}
function Stop-YsmServices {
    $c = Ysm-Config
    if (-not $c) { return }
    $listeners = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $c.controlPort -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { return }
    $state = Ysm-Control 'status'
    if ($listeners.Count -ne 1 -or $state.protocol -ne 'YSM-SERVICES-V1' -or $state.pid -ne $listeners[0].OwningProcess) { throw 'YSM supervisor identity mismatch' }
    $null = Ysm-Control 'stop'
    $deadline = (Get-Date).AddSeconds(100)
    while (Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $c.controlPort -State Listen -ErrorAction SilentlyContinue) {
        if ((Get-Date) -gt $deadline) { throw 'YSM services did not stop cleanly; backup cancelled' }
        Start-Sleep -Milliseconds 500
    }
    foreach ($port in @(Ysm-ChildPorts $c)) {
        if (Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw 'YSM child listener remains; backup cancelled' }
    }
    Log 'Configured YSM services stopped cleanly'
}
function Backup-YsmServices([string]$destination) {
    $c = Ysm-Config
    if (-not $c -or -not (Test-Path -LiteralPath $c.root)) { return }
    foreach ($port in @($c.controlPort)+@(Ysm-ChildPorts $c)) {
        if (Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw 'YSM snapshot requires stopped services' }
    }
    $target = Join-Path $destination 'ysm-private'
    & robocopy.exe $c.root $target /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /XD 'logs' 'tmp' | Out-Null
    if ($LASTEXITCODE -ge 8) { throw 'YSM private snapshot failed' }
    $requiredFiles=@('proxy\velocity.toml')
    if ($c.PSObject.Properties.Name -contains 'auth' -and $null -ne $c.auth) {
        $authRoot=[IO.Path]::GetFullPath($c.root).TrimEnd([char[]]@('\','/'))+'\'
        $authProperties=[IO.Path]::GetFullPath($c.auth.properties)
        if(-not$authProperties.StartsWith($authRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Authentication snapshot path outside private root'}
        $relativeAuth=$authProperties.Substring($authRoot.Length)
        $requiredFiles+=@($relativeAuth)
    }
    $nativeMode=$c.PSObject.Properties.Name -contains 'appearanceBackend' -and $c.appearanceBackend -eq 'native265'
    foreach ($legacy in @('worker\server.properties','proxy\plugins\agentappearance\models.json')) {
        if (-not $nativeMode -or (Test-Path -LiteralPath (Join-Path $c.root $legacy))) { $requiredFiles+=@($legacy) }
    }
    $loginStore = 'proxy\plugins\LibreLogin\user-data.db'
    if (Test-Path -LiteralPath (Join-Path $c.root $loginStore) -PathType Leaf) { $requiredFiles += $loginStore }
    foreach ($relative in $requiredFiles) {
        if ((Get-FileHash -LiteralPath (Join-Path $c.root $relative)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $target $relative)).Hash) { throw "YSM private snapshot mismatch: $relative" }
    }
}
