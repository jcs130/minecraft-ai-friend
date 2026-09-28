$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Run this one-time task registration from an elevated PowerShell window.' }

$ps = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$script = 'E:\MC\ops\manage-server.ps1'
if (-not (Test-Path -LiteralPath $script)) { throw "Missing $script" }
$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType S4U -RunLevel Limited
$watchAction = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" Watchdog"
$watchTriggers = @(
    (New-ScheduledTaskTrigger -AtStartup),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1))
)
$watchSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$backupAction = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" Backup"
$backupTrigger = New-ScheduledTaskTrigger -Daily -At '04:00'
$backupSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

$snapshot = Join-Path 'E:\MC\ops' ('scheduled-tasks-before-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $snapshot -Force | Out-Null
foreach ($name in @('Afu-MC-Watchdog', 'Afu-MC-DailyBackup')) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Export-ScheduledTask -TaskName $name | Set-Content -LiteralPath (Join-Path $snapshot "$name.xml") -Encoding UTF8
    }
}

Register-ScheduledTask -TaskName 'Afu-MC-Watchdog' -Action $watchAction -Trigger $watchTriggers `
    -Settings $watchSettings -Principal $principal -Description 'Start Paper at boot and restore it after crashes.' -Force | Out-Null
Register-ScheduledTask -TaskName 'Afu-MC-DailyBackup' -Action $backupAction -Trigger $backupTrigger `
    -Settings $backupSettings -Principal $principal -Description '04:00 backup when no human players are online, then mirror to F: after restart.' -Force | Out-Null
Start-ScheduledTask -TaskName 'Afu-MC-Watchdog'
Start-Sleep -Seconds 3
$info = Get-ScheduledTaskInfo -TaskName 'Afu-MC-Watchdog'
if ($info.LastTaskResult -ne 0) { throw "Boot watchdog test failed: $($info.LastTaskResult). Check Task Scheduler History." }
Get-ScheduledTask -TaskName 'Afu-MC-Watchdog','Afu-MC-DailyBackup' |
    Select-Object TaskName,State,@{Name='LogonType';Expression={$_.Principal.LogonType}}
Write-Host "Previous task definitions: $snapshot"
