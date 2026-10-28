[CmdletBinding()]
param([ValidateSet('Auto', 'System', 'User')][string]$Mode = 'Auto')

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runtime = 'E:\ai-models\drama3-20261028\speechcpp'
$exe = Join-Path $runtime 'runtime\speech.exe'
$dll = Join-Path $runtime 'runtime\speech.dll'
$model = Join-Path $runtime 'models\Drama-35B-A3B-v3-Q4_K.gguf'
$python = 'C:\Python314\python.exe'
$voiceService = Join-Path $PSScriptRoot 'voice_service.py'
$watchScript = Join-Path $PSScriptRoot 'Watch-Drama3Service.ps1'
$pwsh = 'C:\Program Files\PowerShell\7\pwsh.exe'
$stateDir = Join-Path $repo 'server\drama3-service'
$backup = Join-Path $stateDir 'previous-state.json'
$serviceTask = 'Drama3-Speech'
$watchTask = 'Drama3-Watchdog'
$proxyTask = 'TqLLM LAN Proxy'
$firewallName = 'Qiandeng-Drama3-LAN-18120'
$hashExpected = '2A57B14C9B208A2FF833AB7305B920CA8F154AD807004A52D96A86A90A55523E'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if ($Mode -eq 'Auto') { $Mode = 'User' }
if ($Mode -eq 'System' -and -not $admin) { throw 'System mode needs an elevated PowerShell session' }

foreach ($path in @($exe, $dll, $model, $python, $voiceService, $watchScript, $pwsh,
                  (Join-Path $runtime 'kirito.voice.gguf'),
                  (Join-Path $runtime 'yui.voice.gguf'),
                  (Join-Path $runtime 'cast.voice.gguf'))) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing deployment file: $path" }
}
if ((Get-Item -LiteralPath $model).Length -ne 20787264352) { throw 'Unexpected Drama 3 model size' }
if ((Get-FileHash -LiteralPath $model -Algorithm SHA256).Hash -ne $hashExpected) {
    throw 'Drama 3 model SHA-256 mismatch'
}
$version = (& $exe --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $version -notmatch 'speech\.cpp 0\.9\.0') {
    throw "Unexpected speech.cpp release: $version"
}

New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$container = 'qwen38-27b-lan'
$containerPresent = $false
$wasRunning = $false
$restartPolicy = 'no'
if (Get-Command docker -ErrorAction SilentlyContinue) {
    $containerState = docker inspect $container --format '{{.State.Running}}' 2>$null
    if ($LASTEXITCODE -eq 0) {
        $containerPresent = $true
        $wasRunning = (($containerState -join '').Trim() -eq 'true')
        $restartPolicy = ((docker inspect $container --format '{{.HostConfig.RestartPolicy.Name}}') -join '').Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Qwen restart policy' }
    }
}
$proxy = Get-ScheduledTask -TaskName $proxyTask -ErrorAction SilentlyContinue
$proxyWasEnabled = $null -ne $proxy -and $proxy.State -ne 'Disabled'
$proxyWasRunning = $null -ne $proxy -and $proxy.State -eq 'Running'
if (-not (Test-Path -LiteralPath $backup)) {
    @{
        saved_at = (Get-Date).ToString('o')
        qwen_container = $container
        qwen_container_present = $containerPresent
        qwen_running = $wasRunning
        qwen_restart_policy = $restartPolicy
        proxy_task = $proxyTask
        proxy_enabled = $proxyWasEnabled
        proxy_running = $proxyWasRunning
    } | ConvertTo-Json | Set-Content -LiteralPath $backup -Encoding UTF8
}

$changedLLM = $false
$firewallCreated = $false
$firewallConfigured = $false
$previousTasks = @{}
try {
    foreach ($name in @($serviceTask, $watchTask)) {
        $existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if ($null -ne $existing) {
            $previousTasks[$name] = @{
                xml = Export-ScheduledTask -TaskName $name
                running = $existing.State -eq 'Running'
            }
            if ($existing.State -eq 'Running') {
                Stop-ScheduledTask -TaskName $name
                if ($name -eq $serviceTask) { Start-Sleep -Seconds 2 }
            }
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
        }
    }

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    if ($Mode -eq 'System') {
        $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
        $onStart = New-ScheduledTaskTrigger -AtStartup
    } else {
        $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
        $onStart = New-ScheduledTaskTrigger -AtLogOn -User $identity
    }
    $repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
        -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
    $settings = New-ScheduledTaskSettingsSet -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
        -MultipleInstances IgnoreNew -StartWhenAvailable -Priority 4
    $watchSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 1) `
        -MultipleInstances IgnoreNew -StartWhenAvailable
    # Task Scheduler owns the Python model process itself. A PowerShell wrapper
    # would leave it orphaned when Stop-ScheduledTask terminates only the wrapper.
    $serviceArguments = @(
        '-u', ('"' + $voiceService + '"'),
        '--host', '0.0.0.0', '--port', '18120',
        '--state', ('"' + $stateDir + '"')
    ) -join ' '
    $serviceAction = New-ScheduledTaskAction -Execute $python -Argument $serviceArguments `
        -WorkingDirectory $repo
    $watchAction = New-ScheduledTaskAction -Execute $pwsh `
        -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $watchScript + '"') `
        -WorkingDirectory $repo
    Register-ScheduledTask -TaskName $serviceTask -Action $serviceAction -Trigger $onStart `
        -Principal $principal -Settings $settings -Description 'Dedicated Drama 3 voice registry and speech server on port 18120' -Force | Out-Null
    Register-ScheduledTask -TaskName $watchTask -Action $watchAction -Trigger @($onStart, $repeat) `
        -Principal $principal -Settings $watchSettings -Description 'Restart Drama 3 when HTTP health is lost' -Force | Out-Null

    if ($admin) {
        $oldRule = Get-NetFirewallRule -Name $firewallName -ErrorAction SilentlyContinue
        if ($null -ne $oldRule) {
            $portFilter = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $oldRule
            $addressFilter = Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $oldRule
            if ($oldRule.Direction -ne 'Inbound' -or $oldRule.Action -ne 'Allow' -or
                $oldRule.Enabled -ne 'True' -or $oldRule.Profile -ne 'Private' -or
                $portFilter.Protocol -ne 'TCP' -or $portFilter.LocalPort -ne '18120' -or
                @('192.168.3.0/24', '192.168.3.0/255.255.255.0') -notcontains
                    ($addressFilter.RemoteAddress -join ',')) {
                throw "Existing firewall rule $firewallName has an unexpected scope"
            }
        } else {
            New-NetFirewallRule -Name $firewallName -DisplayName 'Drama 3 speech LAN 18120' `
                -Direction Inbound -Protocol TCP -LocalPort 18120 -RemoteAddress '192.168.3.0/24' `
                -Profile Private -Action Allow -Enabled True | Out-Null
            $firewallCreated = $true
        }
        $firewallConfigured = $true
    }

    if ($containerPresent) {
        $changedLLM = $true
        docker update --restart=no $container | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Cannot disable local Qwen container autostart' }
        if ($wasRunning) {
            docker stop --time 30 $container | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Cannot stop local Qwen container' }
        }
    }
    if ($null -ne $proxy) {
        if ($proxyWasRunning) { Stop-ScheduledTask -TaskName $proxyTask }
        Disable-ScheduledTask -TaskName $proxyTask | Out-Null
    }

    Start-ScheduledTask -TaskName $serviceTask
    $healthy = $false
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        Start-Sleep -Seconds 2
        try {
            $reply = Invoke-RestMethod -Uri 'http://127.0.0.1:18120/health' -TimeoutSec 3
            if ($reply.status -eq 'ok') { $healthy = $true; break }
        } catch { }
        $task = Get-ScheduledTask -TaskName $serviceTask
        if ($task.State -ne 'Running' -and $attempt -gt 5) { break }
    }
    if (-not $healthy) { throw 'Drama 3 HTTP health did not become ready' }
    & python (Join-Path $PSScriptRoot 'drama3_health.py') --smoke
    if ($LASTEXITCODE -ne 0) { throw 'Drama 3 real speech smoke failed' }
    Start-ScheduledTask -TaskName $watchTask
    @{
        installed_at = (Get-Date).ToString('o')
        mode = $Mode
        version = $version
        endpoint = 'http://192.168.3.133:18120/v1'
        service_task = $serviceTask
        watchdog_task = $watchTask
        firewall_rule = if ($firewallConfigured) { $firewallName } else { $null }
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateDir 'deployment.json') -Encoding UTF8
    Write-Output "Drama 3 ready; mode=$Mode; endpoint=http://192.168.3.133:18120/v1"
} catch {
    $failure = $_
    foreach ($name in @($watchTask, $serviceTask)) {
        $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if ($null -ne $task) {
            if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue }
            Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
        }
    }
    foreach ($name in @($serviceTask, $watchTask)) {
        if ($previousTasks.ContainsKey($name)) {
            Register-ScheduledTask -TaskName $name -Xml $previousTasks[$name].xml -Force -ErrorAction SilentlyContinue | Out-Null
            if ($previousTasks[$name].running) {
                Start-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
            }
        }
    }
    if ($firewallCreated) { Remove-NetFirewallRule -Name $firewallName -ErrorAction SilentlyContinue }
    if ($changedLLM) {
        docker update --restart=$restartPolicy $container | Out-Null
        if ($wasRunning) { docker start $container | Out-Null }
        if ($null -ne $proxy -and $proxyWasEnabled) {
            Enable-ScheduledTask -TaskName $proxyTask -ErrorAction SilentlyContinue | Out-Null
            if ($proxyWasRunning) { Start-ScheduledTask -TaskName $proxyTask -ErrorAction SilentlyContinue }
        }
    }
    throw $failure
}
