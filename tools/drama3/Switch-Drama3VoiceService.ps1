#Requires -RunAsAdministrator
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$state = Join-Path $repo 'server\drama3-service'
$python = 'C:\Python314\python.exe'
$service = Join-Path $PSScriptRoot 'voice_service.py'
$taskName = 'Drama3-Speech'
foreach ($path in @($python, $service)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing file: $path" }
}
New-Item -ItemType Directory -Path $state -Force | Out-Null
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
if ($task.Principal.LogonType -ne 'Interactive') {
    throw 'Drama3-Speech must remain an interactive user task for Vulkan synthesis'
}
$previousAction = $task.Actions
$wasRunning = $task.State -eq 'Running'
$backup = Join-Path $state 'before-voice-registry-task.xml'
if (-not (Test-Path -LiteralPath $backup)) {
    Export-ScheduledTask -TaskName $taskName | Set-Content -LiteralPath $backup -Encoding UTF8
}
$arguments = @(
    '-u', ('"' + $service + '"'),
    '--host', '0.0.0.0', '--port', '18120',
    '--state', ('"' + $state + '"')
) -join ' '
$action = New-ScheduledTaskAction -Execute $python -Argument $arguments -WorkingDirectory $repo
$changed = $false
try {
    if ($wasRunning) { Stop-ScheduledTask -TaskName $taskName; Start-Sleep -Seconds 3 }
    Set-ScheduledTask -TaskName $taskName -Action $action | Out-Null
    $changed = $true
    Start-ScheduledTask -TaskName $taskName
    $healthy = $false
    for ($i = 0; $i -lt 90; $i++) {
        Start-Sleep -Seconds 2
        try {
            $reply = Invoke-RestMethod 'http://127.0.0.1:18120/health' -TimeoutSec 2
            if ($reply.status -eq 'ok') { $healthy = $true; break }
        } catch { }
        if ((Get-ScheduledTask -TaskName $taskName).State -ne 'Running' -and $i -gt 5) { break }
    }
    if (-not $healthy) { throw 'new voice service did not become healthy' }
    & $python (Join-Path $PSScriptRoot 'drama3_health.py') --smoke
    if ($LASTEXITCODE -ne 0) { throw 'existing Kirito/Yui/cast synthesis failed' }
    $voices = (Invoke-RestMethod 'http://127.0.0.1:18120/v1/audio/voices' -TimeoutSec 10).data
    foreach ($name in @('none', 'kirito', 'yui', 'cast')) {
        if (-not ($voices | Where-Object { $_.voice_id -eq $name -and $_.status -eq 'ready' })) {
            throw "built-in voice $name is not ready"
        }
    }
    $deployment = @{}
    $deploymentPath = Join-Path $state 'deployment.json'
    if (Test-Path -LiteralPath $deploymentPath) {
        $deployment = Get-Content -LiteralPath $deploymentPath -Raw | ConvertFrom-Json -AsHashtable
    }
    $deployment['voice_registry_enabled'] = $true
    $deployment['voice_registry_switched_at'] = (Get-Date).ToString('o')
    $deployment['voice_registry_python'] = $python
    $deployment | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $deploymentPath -Encoding UTF8
    Write-Output 'Drama 3 voice registry is ready on port 18120; existing voices passed real synthesis'
} catch {
    $failure = $_
    if ($changed) {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        Set-ScheduledTask -TaskName $taskName -Action $previousAction -ErrorAction SilentlyContinue | Out-Null
    }
    if ($wasRunning) { Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }
    throw $failure
}
