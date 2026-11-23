param([Parameter(Mandatory)][string]$Config, [Parameter(Mandatory)][string]$TaskName)
$ErrorActionPreference = 'Stop'
$watch = Join-Path $PSScriptRoot 'Watch-HostedCortico.ps1'
$configPath = (Resolve-Path -LiteralPath $Config).ProviderPath
$cfg = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($TaskName -cnotmatch '^[A-Za-z0-9_-]{1,80}$' -or "$watch$configPath" -match '["\r\n]') {
    throw 'Invalid task name or file path'
}
if (@(Get-ScheduledTask | Where-Object TaskName -ceq $TaskName).Count) {
    throw 'A task by this name is already registered'
}
$original = Get-ScheduledTask -TaskName $cfg.launchTask
$who = [Security.Principal.WindowsIdentity]::GetCurrent()
$owner = New-Object Security.Principal.NTAccount($original.Principal.UserId)
if ($owner.Translate([Security.Principal.SecurityIdentifier]).Value -cne $who.User.Value) {
    throw 'Run the watchdog installer as the account that owns the Cortico launcher'
}
$shell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $watch + '" -Config "' + $configPath + '"'
$action = New-ScheduledTaskAction -Execute $shell -Argument $arguments -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 50) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $who.Name -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Reconcile the existing Numen Cortico instance; start its assigned launcher only from a vacant seat.'
