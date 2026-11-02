param([string]$Root)
$ErrorActionPreference='Stop'
while(-not [IO.File]::Exists((Join-Path $Root 'go'))){Start-Sleep -Milliseconds 100}
. (Join-Path $Root 'independent-process.ps1')
$env:QD_TEST_INHERIT='fixture only'
$shell=Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\v1.0\powershell.exe'
$legacy=Start-Process -FilePath $shell -ArgumentList @('-NoProfile','-File',"`"$Root\heartbeat.ps1`"",'-Path',"`"$Root\legacy.beats`"",'-Stop',"`"$Root\stop`"") -WindowStyle Hidden -PassThru
$fixed=Start-IndependentProcess -FilePath $shell -ArgumentList @('-NoProfile','-File',"`"$Root\heartbeat.ps1`"",'-Path',"`"$Root\fixed.beats`"",'-Stop',"`"$Root\stop`"") -WorkingDirectory $Root -RedirectStandardOutput (Join-Path $Root 'fixed.out') -RedirectStandardError (Join-Path $Root 'fixed.err') -PassThru
@{legacy=$legacy.Id;fixed=$fixed.Id;parent=$PID}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $Root 'children.json')
Start-Sleep -Seconds 45
