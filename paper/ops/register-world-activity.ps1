param(
    [Parameter(Mandatory=$true)][string]$Python,
    [string]$OpsRoot = 'E:\MC\ops',
    [string]$Server = 'E:\MC\server'
)
$ErrorActionPreference = 'Stop'
$activityTaskName = 'Qiandengji-World-Activity'
foreach ($activityPath in @($Python, (Join-Path $OpsRoot 'world-activity-run.ps1'), (Join-Path $OpsRoot 'world-activity.py'), (Join-Path $OpsRoot 'world-activity-catalogue.json'))) {
    if (-not (Test-Path -LiteralPath $activityPath -PathType Leaf)) { throw "Missing required file: $activityPath" }
}
if (Get-ScheduledTask -TaskName $activityTaskName -ErrorAction SilentlyContinue) { throw 'Task already exists; inspect and update it explicitly instead of replacing it.' }
# Hidden wrapper follows the existing portal's per-user scheduled service model.
$activityPs = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$activityCommand = '"{0}" -NoProfile -NonInteractive -WindowStyle Hidden -File "{1}" -Python "{2}" -OpsRoot "{3}" -Server "{4}"' -f $activityPs,(Join-Path $OpsRoot 'world-activity-run.ps1'),$Python,$OpsRoot,$Server
$activityVbs = 'CreateObject("WScript.Shell").Run "' + $activityCommand.Replace('"','""') + '", 0, True'
$activityWrapper = Join-Path $OpsRoot 'world-activity-hidden.vbs'
if (Test-Path -LiteralPath $activityWrapper) { throw 'Hidden wrapper already exists; reconcile it first.' }
[IO.File]::WriteAllText($activityWrapper,$activityVbs,[Text.Encoding]::Unicode)
$activityAction = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\wscript.exe" -Argument ('"{0}"' -f $activityWrapper)
$activityTriggers = @((New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)), (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)))
$activityPrincipal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$activitySettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 45) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $activityTaskName -Action $activityAction -Trigger $activityTriggers -Principal $activityPrincipal -Settings $activitySettings -Description 'Read-only world activity snapshot every minute; no game writes. Requires the existing operator Windows session.' | Out-Null
Start-ScheduledTask -TaskName $activityTaskName
Get-ScheduledTask -TaskName $activityTaskName | Select-Object TaskName,State
