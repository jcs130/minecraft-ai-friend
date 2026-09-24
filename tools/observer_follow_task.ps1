param(
    [Parameter(Mandatory=$true)][string]$Python,
    [Parameter(Mandatory=$true)][string]$Watcher
)

$ErrorActionPreference = 'Stop'
$taskName = 'QiandengJi.ObserverFollow'
$pythonw = Join-Path (Split-Path -Parent $Python) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonw -PathType Leaf)) {
    throw 'pythonw.exe is unavailable beside the selected Python interpreter'
}
if (-not (Test-Path -LiteralPath $Watcher -PathType Leaf)) {
    throw 'Observer watcher script is unavailable'
}
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$argument = '"' + $Watcher + '" watch'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -eq $existing -or $existing.Actions[0].Execute -ne $pythonw -or $existing.Actions[0].Arguments -ne $argument) {
    $action = New-ScheduledTaskAction -Execute $pythonw -Argument $argument
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    $existing = Get-ScheduledTask -TaskName $taskName
}
if ($existing.State -ne 'Running') {
    Start-ScheduledTask -TaskName $taskName
}
Write-Output ('observer follow task state=' + (Get-ScheduledTask -TaskName $taskName).State)
