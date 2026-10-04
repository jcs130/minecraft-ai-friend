param(
    [ValidateSet('Plan', 'Register', 'Start', 'Unregister')][string]$Mode = 'Plan',
    [ValidateSet('Auto', 'S4U', 'Interactive', 'Run', 'Startup')][string]$StartupMethod = 'Auto',
    [Parameter(Mandatory=$true)][string]$Python,
    [Parameter(Mandatory=$true)][string]$Config
)

$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'maw_service.py'
$pythonPath = (Resolve-Path -LiteralPath $Python -ErrorAction Stop).Path
$configPath = (Resolve-Path -LiteralPath $Config -ErrorAction Stop).Path
$pythonw = Join-Path (Split-Path -Parent $pythonPath) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonw -PathType Leaf)) { throw 'pythonw.exe required for hidden unattended supervision' }
$planText = & $pythonPath $scriptPath plan --config $configPath
if ($LASTEXITCODE -ne 0) { throw ('Supervisor configuration validation failed: ' + $planText) }
$plan = $planText | ConvertFrom-Json
$taskName = 'MyAgentWorld.Service.' + $plan.services[0].port
$argument = '"' + $scriptPath + '" run --config "' + $configPath + '"'
$runCommand = '"' + $pythonw + '" ' + $argument
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$recordPath = Join-Path $plan.runtimeDir 'startup.json'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) ($taskName + '.lnk')

function Get-ServiceTask {
    Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}

function Assert-OwnedTask($task) {
    if ($null -ne $task -and ($task.Actions.Count -ne 1 -or $task.Actions[0].Execute -ne $pythonw -or $task.Actions[0].Arguments -ne $argument)) {
        throw 'Existing task action differs; refusing to modify another service'
    }
}

function Get-RunValue {
    try {
        $values = Get-ItemProperty -LiteralPath $runKey -ErrorAction Stop
    } catch [System.Management.Automation.ItemNotFoundException] {
        return $null
    }
    # Query the key once, then inspect the property without asking the registry
    # provider to throw when this new service's value has never existed.
    $property = $values.PSObject.Properties[$taskName]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-ServiceShortcut {
    if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
        (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    }
}

function Assert-OwnedStartup {
    $runValue = Get-RunValue
    if ($null -ne $runValue -and $runValue -ne $runCommand) { throw 'Existing HKCU startup value differs; refusing to overwrite it' }
    $shortcut = Get-ServiceShortcut
    if ($null -ne $shortcut -and ($shortcut.TargetPath -ne $pythonw -or $shortcut.Arguments -ne $argument)) {
        throw 'Existing Startup shortcut differs; refusing to overwrite it'
    }
}

function Initialize-PrivateMailbox {
    # New service IPC only. No authenticated HTTP admin is opened.
    New-Item -ItemType Directory -Path $plan.runtimeDir -Force -ErrorAction Stop | Out-Null
    $operatorSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $allowedSids = @($operatorSid, 'S-1-5-18', 'S-1-5-32-544')
    $current = Get-Acl -LiteralPath $plan.runtimeDir -ErrorAction Stop
    $rules = @($current.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    $private = $current.AreAccessRulesProtected -and $rules.Count -eq 3
    foreach ($sid in $allowedSids) {
        $matching = @($rules | Where-Object {
            $_.IdentityReference.Value -eq $sid -and $_.AccessControlType -eq 'Allow' -and
            $_.FileSystemRights -eq 'FullControl' -and $_.InheritanceFlags -eq 'ContainerInherit, ObjectInherit'
        })
        if ($matching.Count -ne 1) { $private = $false }
    }
    if ($private) { $script:mailboxAclStatus = 'existing_private_dacl_verified'; return }

    # icacls changes the DACL only. Do not set owner/group/SACL, which can ask a
    # standard operator for SeSecurityPrivilege even when WRITE_DAC is allowed.
    $aclArguments = @($plan.runtimeDir, '/inheritance:r', '/grant:r')
    foreach ($sid in $allowedSids) { $aclArguments += ('*' + $sid + ':(OI)(CI)F') }
    foreach ($rule in $rules) {
        if (-not $rule.IsInherited -and $rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowedSids) {
            $aclArguments += @('/remove:g', ('*' + $rule.IdentityReference.Value))
        }
        if (-not $rule.IsInherited -and $rule.AccessControlType -eq 'Deny') {
            $aclArguments += @('/remove:d', ('*' + $rule.IdentityReference.Value))
        }
    }
    & icacls.exe @aclArguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw ('Private mailbox DACL update failed, icacls exit=' + $LASTEXITCODE) }
    $readBack = Get-Acl -LiteralPath $plan.runtimeDir -ErrorAction Stop
    $rules = @($readBack.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    if (-not $readBack.AreAccessRulesProtected -or $rules.Count -ne 3) { throw 'Private mailbox DACL read-back mismatch' }
    foreach ($sid in $allowedSids) {
        $matching = @($rules | Where-Object {
            $_.IdentityReference.Value -eq $sid -and $_.AccessControlType -eq 'Allow' -and
            $_.FileSystemRights -eq 'FullControl' -and $_.InheritanceFlags -eq 'ContainerInherit, ObjectInherit'
        })
        if ($matching.Count -ne 1) { throw 'Private mailbox DACL read-back mismatch' }
    }
    $script:mailboxAclStatus = 'private_dacl_set_and_verified'
}

function Register-OwnedTask([string]$method) {
    $action = New-ScheduledTaskAction -Execute $pythonw -Argument $argument -WorkingDirectory $PSScriptRoot -ErrorAction Stop
    if ($method -eq 'S4U') {
        $triggers = @(
            New-ScheduledTaskTrigger -AtStartup -ErrorAction Stop
            New-ScheduledTaskTrigger -AtLogOn -User $account -ErrorAction Stop
        )
        $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType S4U -RunLevel Limited -ErrorAction Stop
    } else {
        $triggers = @(New-ScheduledTaskTrigger -AtLogOn -User $account -ErrorAction Stop)
        $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited -ErrorAction Stop
    }
    $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ErrorAction Stop
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
    $registered = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    Assert-OwnedTask $registered
    if ($registered.Principal.LogonType.ToString() -ne $method) { throw 'Registered task logon type did not match the requested method' }
}

if ($Mode -eq 'Plan') {
    [pscustomobject]@{
        taskName=$taskName; execute=$pythonw; arguments=$argument; account=$account
        preferred=$StartupMethod; fallbackOrder=@('S4U', 'Interactive', 'Run', 'Startup')
        serverDir=$plan.serverDir; healthPort=$plan.healthPort; hkcuRunName=$taskName; startupShortcut=$shortcutPath
        note='No registration or launch performed. Interactive/Run/Startup start after this user logs in; they do not guarantee pre-login boot startup.'
    } | ConvertTo-Json
    exit 0
}

if ($Mode -eq 'Register') {
    $existing = Get-ServiceTask
    Assert-OwnedTask $existing
    Assert-OwnedStartup
    if ($null -ne $existing -and $existing.State -eq 'Running') {
        throw 'Gracefully shutdown this supervisor via maw_service.py before replacing its startup entry'
    }
    Initialize-PrivateMailbox
    $methods = if ($StartupMethod -eq 'Auto') { @('S4U', 'Interactive', 'Run', 'Startup') } else { @($StartupMethod) }
    $failures = @()
    $selected = $null
    foreach ($method in $methods) {
        try {
            if ($method -in @('S4U', 'Interactive')) {
                Register-OwnedTask $method
            } elseif ($method -eq 'Run') {
                if (-not (Test-Path -LiteralPath $runKey)) {
                    New-Item -Path $runKey -ErrorAction Stop | Out-Null
                }
                New-ItemProperty -LiteralPath $runKey -Name $taskName -Value $runCommand -PropertyType String -Force -ErrorAction Stop | Out-Null
                if ((Get-RunValue) -ne $runCommand) { throw 'HKCU startup value read-back mismatch' }
            } else {
                $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
                $shortcut.TargetPath = $pythonw
                $shortcut.Arguments = $argument
                $shortcut.WorkingDirectory = $PSScriptRoot
                $shortcut.WindowStyle = 7
                $shortcut.Description = 'Own My Agent World processes; respects persistent maintenance pause'
                $shortcut.Save()
                $readBack = Get-ServiceShortcut
                if ($null -eq $readBack -or $readBack.TargetPath -ne $pythonw -or $readBack.Arguments -ne $argument) { throw 'Startup shortcut read-back mismatch' }
            }
            $selected = $method
            break
        } catch {
            $failures += [pscustomobject]@{ method=$method; reason=$_.Exception.Message }
        }
    }
    if ($null -eq $selected) { throw ('No current-user startup method succeeded: ' + ($failures | ConvertTo-Json -Compress)) }
    $record = [pscustomobject]@{
        schemaVersion=1; method=$selected; taskName=$taskName; execute=$pythonw; arguments=$argument
        registeredAt=[DateTime]::UtcNow.ToString('o'); account=$account; failures=$failures
        mailboxPermissions=$script:mailboxAclStatus
        preLoginBootStartup=($selected -eq 'S4U'); started=$false
    }
    $record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $recordPath -Encoding UTF8 -ErrorAction Stop
    $record | ConvertTo-Json -Depth 5
    exit 0
}

if (-not (Test-Path -LiteralPath $recordPath -PathType Leaf)) { throw 'No successful new-service startup registration record found' }
$record = Get-Content -LiteralPath $recordPath -Raw -ErrorAction Stop | ConvertFrom-Json
if ($record.schemaVersion -ne 1 -or $record.taskName -ne $taskName -or $record.execute -ne $pythonw -or $record.arguments -ne $argument) {
    throw 'Startup registration identity mismatch'
}
Assert-OwnedStartup
if ($Mode -eq 'Start') {
    if ($record.method -in @('S4U', 'Interactive')) {
        $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
        Assert-OwnedTask $existing
        Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
    } elseif ($record.method -in @('Run', 'Startup')) {
        Start-Process -FilePath $pythonw -ArgumentList $argument -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -ErrorAction Stop | Out-Null
    } else { throw 'Unknown startup registration method' }
    [pscustomobject]@{ ok=$true; state='launch_requested'; method=$record.method; taskName=$taskName; healthPort=$plan.healthPort } | ConvertTo-Json
} else {
    $healthPath = Join-Path $plan.runtimeDir 'health.json'
    if (Test-Path -LiteralPath $healthPath -PathType Leaf) {
        $health = Get-Content -LiteralPath $healthPath -Raw -ErrorAction Stop | ConvertFrom-Json
        $nowEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        if ($nowEpoch - $health.heartbeatEpoch -lt 15) { throw 'Use maw_service.py shutdown and wait for graceful supervisor exit before unregistering' }
    }
    if ($record.method -in @('S4U', 'Interactive')) {
        $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
        Assert-OwnedTask $existing
        if ($existing.State -eq 'Running') { throw 'Scheduled supervisor is still running; no task force-stop is offered' }
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
    } elseif ($record.method -eq 'Run') {
        if ((Get-RunValue) -ne $runCommand) { throw 'HKCU startup identity mismatch' }
        Remove-ItemProperty -LiteralPath $runKey -Name $taskName -ErrorAction Stop
    } elseif ($record.method -eq 'Startup') {
        if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { throw 'Startup shortcut is missing' }
        Remove-Item -LiteralPath $shortcutPath -ErrorAction Stop
    } else { throw 'Unknown startup registration method' }
    Remove-Item -LiteralPath $recordPath -ErrorAction Stop
    [pscustomobject]@{ ok=$true; state='unregistered'; method=$record.method; taskName=$taskName } | ConvertTo-Json
}
