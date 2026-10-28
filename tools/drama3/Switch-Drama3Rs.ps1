#Requires -RunAsAdministrator
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$state = Join-Path $repo 'server\drama3-service'
$python = 'C:\Python314\python.exe'
$service = Join-Path $PSScriptRoot 'drama_rs_service.py'
$smoke = Join-Path $PSScriptRoot 'drama_rs_health.py'
$taskName = 'Drama3-Speech'
$maintenance = Join-Path $state 'maintenance-until.txt'
foreach ($path in @($python, $service, $smoke)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing file: $path" }
}
$firewall = Get-NetFirewallRule -DisplayName 'Drama 3 speech LAN 18120' -ErrorAction Stop
$remote = ($firewall | Get-NetFirewallAddressFilter).RemoteAddress
$port = ($firewall | Get-NetFirewallPortFilter).LocalPort
if ($firewall.Enabled -ne 'True' -or $firewall.Direction -ne 'Inbound' -or
    $firewall.Action -ne 'Allow' -or $port -ne '18120' -or
    $remote -notin @('192.168.3.0/255.255.255.0', '192.168.3.0/24')) {
    throw "Drama 3 LAN firewall scope is unexpected: remote=$remote port=$port"
}
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
if ($task.Principal.LogonType -ne 'Interactive') {
    throw 'Drama3-Speech must remain an interactive user task'
}
$previousAction = $task.Actions
$wasRunning = $task.State -eq 'Running'
$backup = Join-Path $state 'before-drama-rs-task.xml'
Export-ScheduledTask -TaskName $taskName | Set-Content -LiteralPath $backup -Encoding UTF8
$oldHashes = @{}
foreach ($name in @('reference.wav', 'reference.txt', 'voice.gguf')) {
    $path = Join-Path $state "voices\cormy\$name"
    $oldHashes[$name] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
}
New-Item -ItemType Directory -Path $state -Force | Out-Null
([DateTimeOffset]::UtcNow.AddMinutes(15).ToString('o')) |
    Set-Content -LiteralPath $maintenance -Encoding UTF8
$arguments = "-u `"$service`" --host 0.0.0.0 --port 18120 --state `"$state`""
$newAction = New-ScheduledTaskAction -Execute $python -Argument $arguments -WorkingDirectory $repo
$changed = $false
try {
    if ($wasRunning) {
        Stop-ScheduledTask -TaskName $taskName
        Start-Sleep -Seconds 5
    }
    $oldProcess = Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object {
        $_.CommandLine -match 'drama3[\\/]voice_service[.]py' -and
        $_.CommandLine -match '--port 18120(?:\s|$)'
    }
    foreach ($process in $oldProcess) { Stop-Process -Id $process.ProcessId -Force }
    Set-ScheduledTask -TaskName $taskName -Action $newAction | Out-Null
    $changed = $true
    Start-ScheduledTask -TaskName $taskName
    $ready = $false
    for ($i = 0; $i -lt 180; $i++) {
        Start-Sleep -Seconds 2
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:18120/health' -TimeoutSec 2
            if ($health.status -eq 'ok' -and $health.runtime -eq 'drama-rs') {
                $ready = $true
                break
            }
        } catch { }
        if ((Get-ScheduledTask -TaskName $taskName).State -ne 'Running' -and $i -gt 5) { break }
    }
    if (-not $ready) { throw 'drama-rs gateway did not become healthy' }
    & $python $smoke --base 'http://192.168.3.133:18120' --quick
    if ($LASTEXITCODE -ne 0) { throw 'drama-rs live LAN smoke failed' }
    foreach ($name in $oldHashes.Keys) {
        $path = Join-Path $state "voices\cormy\$name"
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $oldHashes[$name]) {
            throw "Cormy reference asset changed: $name"
        }
    }
    $deploymentPath = Join-Path $state 'deployment.json'
    $deployment = Get-Content -LiteralPath $deploymentPath -Raw | ConvertFrom-Json -AsHashtable
    $deployment['runtime'] = 'drama-rs'
    $deployment['version'] = 'drama-rs 0.3.0 CUDA/Q4'
    $deployment['native_endpoint'] = 'http://127.0.0.1:18121'
    $deployment['endpoint'] = 'http://192.168.3.133:18120/v1'
    $deployment['firewall_rule'] = 'Drama 3 speech LAN 18120'
    $deployment['switched_at'] = (Get-Date).ToString('o')
    $deployment | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $deploymentPath -Encoding UTF8
    Write-Output 'Drama 3 switched to drama-rs on LAN port 18120; Cormy/Kirito/Yui/cast live smoke passed'
} catch {
    $failure = $_
    if ($changed) {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
        & wsl.exe -d Ubuntu-24.04 -- pkill -TERM -x drama 2>$null
        Set-ScheduledTask -TaskName $taskName -Action $previousAction -ErrorAction SilentlyContinue | Out-Null
    }
    if ($wasRunning) { Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }
    throw $failure
} finally {
    Remove-Item -LiteralPath $maintenance -ErrorAction SilentlyContinue
}
