param([Parameter(Mandatory=$true)][string]$Python)
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '../service/media-supervisor.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Supervisor syntax error'}
$definition=$ast.Find({param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq 'Test-VoiceProcessIdentity'},$false)
Invoke-Expression $definition.Extent.Text
$base=& $Python -c 'import sys; print(sys._base_executable)'
if($LASTEXITCODE -ne 0){throw 'Cannot inspect test interpreter'}
$temp=Join-Path ([IO.Path]::GetTempPath()) ('voice-process-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp|Out-Null
$script=Join-Path $temp 'voice_service.py';$config=Join-Path $temp 'config.json'
[IO.File]::WriteAllText($script,"import time`ntime.sleep(12)`n")
[IO.File]::WriteAllText($config,'{}')
$child=Start-Process -FilePath $Python -ArgumentList @('-X','utf8',('"'+$script+'"'),'--config',('"'+$config+'"')) -WindowStyle Hidden -PassThru
$checks=0
function Check([bool]$condition,[string]$name){if(-not $condition){throw $name};$script:checks++}
try{
 Start-Sleep -Seconds 1
 $parent=Get-CimInstance Win32_Process -Filter ('ProcessId='+$child.Id)
 $workers=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$child.Id)|Where-Object {$_.ExecutablePath -eq $base})
 Check ($workers.Count -eq 1) 'Windows venv worker was not created'
 $worker=$workers[0]
 Check (Test-VoiceProcessIdentity $parent $null $Python $base $script $config) 'Exact launcher rejected'
 Check (Test-VoiceProcessIdentity $worker $parent $Python $base $script $config) 'Real venv worker rejected'
 Check (-not(Test-VoiceProcessIdentity $worker $null $Python $base $script $config)) 'Unowned base Python accepted'
 Check (-not(Test-VoiceProcessIdentity $worker $parent $Python $base $script ($config+'.other'))) 'Wrong config accepted'
 Check (-not(Test-VoiceProcessIdentity $worker $parent $Python $base ($script+'.other') $config)) 'Wrong service accepted'
 $fakeParent=$parent|Select-Object ProcessId,ExecutablePath,CommandLine
 $fakeParent.ProcessId++
 Check (-not(Test-VoiceProcessIdentity $worker $fakeParent $Python $base $script $config)) 'Wrong parent accepted'
 Check (-not(Test-VoiceProcessIdentity $worker $parent ($Python+'.other') $base $script $config)) 'Wrong environment accepted'
 Write-Output "PASS $checks real Windows venv process identity checks"
}finally{
 $child.WaitForExit()
 # Only the two files created by this test are removed; no recursive cleanup.
 Remove-Item -LiteralPath $script,$config -Force
 Remove-Item -LiteralPath $temp
}
