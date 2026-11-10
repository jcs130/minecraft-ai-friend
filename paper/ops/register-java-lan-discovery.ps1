param(
 [Parameter(Mandatory=$true)][string]$NodePath,
 [Parameter(Mandatory=$true)][string]$ScriptPath,
 [Parameter(Mandatory=$true)][string]$ConfigPath,
 [switch]$CheckOnly
)
$ErrorActionPreference='Stop'
if($PSVersionTable.PSEdition-ne'Desktop'-or$PSVersionTable.PSVersion.Major-ne 5){throw 'Use native Windows PowerShell 5.1'}
$nativeHome=Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\v1.0'
$native=Join-Path $nativeHome 'Modules'
$env:PSModulePath=$native+';'+(Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'WindowsPowerShell\Modules')
foreach($name in @('ScheduledTasks','NetSecurity')){Import-Module (Join-Path $native ($name+'\'+$name+'.psd1')) -ErrorAction Stop}
foreach($p in @($NodePath,$ScriptPath,$ConfigPath)){
 if(-not[IO.Path]::IsPathRooted($p)-or$p.IndexOfAny([char[]]@('"',"`r","`n"))-ge 0-or-not(Test-Path -LiteralPath $p -PathType Leaf)){throw 'Missing or invalid reviewed runtime file'}
}
$config=Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8|ConvertFrom-Json
$address=$config.interfaceAddress
if(-not(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $address -ErrorAction SilentlyContinue)){throw 'Configured LAN address is absent'}
& $NodePath $ScriptPath --config $ConfigPath --check
if($LASTEXITCODE-ne 0){throw 'Game status checks failed; no discovery task created'}
$taskName='Qiandengji-Java-LAN'
if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){throw 'Discovery task already exists; inspect it instead of overwriting'}
if($CheckOnly){[pscustomobject]@{passed=$true;taskName=$taskName;gameRestarted=$false;productionChanged=$false}|ConvertTo-Json;return}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if(-not([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Windows confirmation is required to register automatic startup'}
$ruleName='Qiandengji Java LAN Multicast'
if(Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue){throw 'Named multicast rule already exists; inspect before modifying'}
$createdRule=$false;$createdTask=$false
try{
 New-NetFirewallRule -DisplayName $ruleName -Direction Outbound -Action Allow -Protocol UDP -Program $NodePath -LocalAddress $address -RemoteAddress '224.0.2.60' -RemotePort 4445 -Profile Any|Out-Null
 $createdRule=$true
 $action=New-ScheduledTaskAction -Execute $NodePath -Argument ('"'+$ScriptPath+'" --config "'+$ConfigPath+'"') -WorkingDirectory ([IO.Path]::GetDirectoryName($ScriptPath))
 $triggers=@((New-ScheduledTaskTrigger -AtStartup),(New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(10) -RepetitionInterval (New-TimeSpan -Minutes 1)))
 $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
 Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -User 'SYSTEM' -RunLevel Limited -Description 'Native Minecraft Java LAN discovery; no game control or client modification.'|Out-Null
 $createdTask=$true
 Start-ScheduledTask -TaskName $taskName
 $deadline=(Get-Date).AddSeconds(35)
 do{
  if(Test-Path -LiteralPath $config.stateFile){
   $state=Get-Content -LiteralPath $config.stateFile -Raw -Encoding UTF8|ConvertFrom-Json
   if($state.phase-eq'announcing'-and$state.interfaceAddress-ceq$address-and$state.port-eq$config.port-and$state.packetsSent-ge 1-and[DateTimeOffset]::UtcNow.Subtract([DateTimeOffset]::Parse($state.observedAt)).TotalSeconds-lt 30-and(Get-ScheduledTask -TaskName $taskName).State-eq'Running'){
    [pscustomobject]@{passed=$true;taskName=$taskName;taskState=(Get-ScheduledTask -TaskName $taskName).State.ToString();gameRestarted=$false;existingInboundRulesChanged=$false}|ConvertTo-Json;return
   }
  }
  Start-Sleep -Milliseconds 500
 }while((Get-Date)-lt$deadline)
 throw 'Discovery did not report a fresh healthy broadcast'
}catch{
 if($createdTask){Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue;Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop}
 if($createdRule){Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction Stop}
 throw
}
