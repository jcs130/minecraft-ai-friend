$ErrorActionPreference='Stop'
$taskParent=Split-Path -Parent $PSScriptRoot
$taskErrors=$null;$taskTokens=$null
$taskAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path $taskParent 'manage-server.ps1'),[ref]$taskTokens,[ref]$taskErrors)
if($taskErrors.Count){throw 'source parse failed'}
foreach($taskName in @('Test-AgentEyeWatcherCommandLine','Start-AgentEyeWatcher')){
 $taskDefinition=$taskAst.FindAll({param($ast) $ast -is [Management.Automation.Language.FunctionDefinitionAst]},$true) | Where-Object {$_.Name -eq $taskName}
 Invoke-Expression $taskDefinition.Extent.Text
}
$node='C:\Runtime\node.exe';$agentEyeWatcherScript='E:\MC\ops\agent-eye-watcher.mjs';$script:checks=0
function Check([string]$label,[bool]$ok){if(-not $ok){throw $label};$script:checks++}
Check 'normal main module' (Test-AgentEyeWatcherCommandLine ('"'+$node+'" '+$agentEyeWatcherScript+' '))
Check 'quoted main module and flags' (Test-AgentEyeWatcherCommandLine ('"'+$node+'" "'+$agentEyeWatcherScript+'" --dry'))
Check 'wrapper mentioning script is excluded' (-not(Test-AgentEyeWatcherCommandLine ('"'+$node+'" helper.mjs --target '+$agentEyeWatcherScript)))
Check 'different executable excluded' (-not(Test-AgentEyeWatcherCommandLine ('node-other.exe '+$agentEyeWatcherScript)))
Check 'suffix lookalike excluded' (-not(Test-AgentEyeWatcherCommandLine ($node+' '+$agentEyeWatcherScript+'.other')))
Check 'missing command line excluded' (-not(Test-AgentEyeWatcherCommandLine $null))
function AgentEyeWatcherProcess { $script:actors }
function Get-CimInstance { param($ClassName,$Filter,$ErrorAction) $id=[int]($Filter -replace '^ProcessId=','');$row=$script:actors|Where-Object {$_.ProcessId -eq $id};if($script:changed){$copy=$row.PSObject.Copy();$copy.CreationDate=$row.CreationDate.AddSeconds(1);return $copy};return $row }
function Stop-Process {param($Id,$Confirm,$ErrorAction) $script:stopped+=@($Id);$script:actors=@($script:actors|Where-Object {$_.ProcessId -ne $Id})}
function Start-Sleep {param($Seconds,$Milliseconds)}
function Log {param($message)}
function Start-Process {throw 'duplicate recovery must not start a third process'}
function Actors {$script:actors=@(101,102)|ForEach-Object {[pscustomobject]@{ProcessId=$_;CreationDate=[datetime]'2026-10-28'+[timespan]::FromSeconds($_);ExecutablePath=$node;CommandLine='"'+$node+'" '+$agentEyeWatcherScript}};$script:stopped=@();$script:changed=$false}
Actors;Start-AgentEyeWatcher
Check 'newest verified instance retained' ($script:actors.Count -eq 1 -and $script:actors[0].ProcessId -eq 102)
Check 'only the verified duplicate is stopped' ($script:stopped.Count -eq 1 -and $script:stopped[0] -eq 101)
Actors;$script:changed=$true;$taskRejected=$false
try{Start-AgentEyeWatcher}catch{$taskRejected=$true}
Check 'PID replacement refuses destructive operation' ($taskRejected -and $script:stopped.Count -eq 0)
. (Join-Path $taskParent 'content-deploy.ps1')
Check 'exact reviewed adapter accepted' (Content-McbotJar 'QiandengjiMcbot-0.1.0.jar')
Check 'other version is rejected' (-not(Content-McbotJar 'QiandengjiMcbot-9.0.0.jar'))
Check 'lookalike prefix rejected' (-not(Content-McbotJar 'QiandengjiMcbot-0.1.0-evil.jar'))
Write-Output ('PASS '+$script:checks+' watcher identity/recovery and deployment boundary checks')
