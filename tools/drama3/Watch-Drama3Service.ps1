[CmdletBinding()]
param(
    [string]$TaskName = 'Drama3-Speech',
    [int]$Port = 18120,
    [string]$StateDirectory = 'D:\Projects\QiandengJi\server\drama3-service'
)

$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
if ($task.State -eq 'Disabled') { exit 2 }
$maintenanceFile = Join-Path $StateDirectory 'maintenance-until.txt'
if (Test-Path -LiteralPath $maintenanceFile -PathType Leaf) {
    $deadline = [DateTimeOffset]::MinValue
    $raw = (Get-Content -LiteralPath $maintenanceFile -Raw).Trim()
    if ([DateTimeOffset]::TryParse($raw, [ref]$deadline)) {
        $remaining = $deadline - [DateTimeOffset]::UtcNow
        if ($remaining.TotalSeconds -gt 0 -and $remaining.TotalMinutes -le 15) { exit 0 }
    }
}
$healthy = $false
try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
    $healthy = $response.status -eq 'ok'
} catch {
    $healthy = $false
}
if ($healthy -and $task.State -eq 'Running') { exit 0 }
$info = Get-ScheduledTaskInfo -TaskName $TaskName
$age = (Get-Date) - $info.LastRunTime
$usingRs = [bool]($task.Actions | Where-Object { $_.Arguments -match 'drama_rs_service[.]py' })
$startupGraceSeconds = if ($usingRs) { 180 } else { 90 }
if ($task.State -eq 'Running' -and $age.TotalSeconds -lt $startupGraceSeconds) {
    # CUDA Q4 cold boot and voice preload can take over 90 seconds.
    exit 0
}

New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
$log = Join-Path $StateDirectory 'watchdog.log'
Add-Content -LiteralPath $log -Encoding UTF8 -Value "$(Get-Date -Format o) unhealthy; task=$($task.State); last_run=$($info.LastRunTime.ToString('o'))"
if ($task.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 3
}
# Kill only an exact Drama 3/port 18120 orphan from a failed task wrapper.
$orphaned = Get-CimInstance Win32_Process -Filter "Name='speech.exe' OR Name='python.exe'" | Where-Object {
    ($_.CommandLine -match 'Drama-35B-A3B-v3-Q4_K\.gguf' -or
     $_.CommandLine -match 'drama3.*voice_service[.]py') -and
    $_.CommandLine -match '--port 18120(?:\s|$)'
}
foreach ($process in $orphaned) {
    Stop-Process -Id $process.ProcessId -Force
    Add-Content -LiteralPath $log -Encoding UTF8 -Value "$(Get-Date -Format o) stopped stale Drama 3 pid=$($process.ProcessId)"
}
# A stopped Windows gateway can leave its WSL child alive. Reap that exact
# runtime before restarting, or the next model load can exhaust the 3090.
if ($usingRs) {
    & wsl.exe -d Ubuntu-24.04 -- pkill -TERM -x drama 2>$null
    Add-Content -LiteralPath $log -Encoding UTF8 -Value "$(Get-Date -Format o) checked stale drama-rs process"
}
Start-ScheduledTask -TaskName $TaskName
Add-Content -LiteralPath $log -Encoding UTF8 -Value "$(Get-Date -Format o) restart requested"
