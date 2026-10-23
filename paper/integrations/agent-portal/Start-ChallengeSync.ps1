param([Parameter(Mandatory=$true)][string]$SyncConfig)
$ErrorActionPreference = 'Stop'
$challengeMain = Join-Path $PSScriptRoot 'scripts/sync-challenges.mjs'
$challengeConfig = (Resolve-Path -LiteralPath $SyncConfig).Path
$challengeDirectory = Join-Path (Split-Path -Parent $challengeConfig) 'challenges'
New-Item -ItemType Directory -Path $challengeDirectory -Force | Out-Null
$challengePidFile = Join-Path $challengeDirectory 'worker.pid'
if (Test-Path -LiteralPath $challengePidFile) {
    $challengeProcessId = [int](Get-Content -LiteralPath $challengePidFile -Raw)
    $challengeProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$challengeProcessId" -ErrorAction SilentlyContinue
    if ($challengeProcess -and $challengeProcess.CommandLine.Contains($challengeMain)) { Write-Output 'Challenge collector already running.'; exit 0 }
}
$challengeStopFile = Join-Path $challengeDirectory 'stop.request'
if (Test-Path -LiteralPath $challengeStopFile) { Remove-Item -LiteralPath $challengeStopFile }
$challengeNode = (Get-Command node -ErrorAction Stop).Source
$challengeArgs = '--max-old-space-size=128 "' + $challengeMain + '" --config "' + $challengeConfig + '"'
$challengeStarted = Start-Process -FilePath $challengeNode -ArgumentList $challengeArgs -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $challengeDirectory 'worker.stdout.log') -RedirectStandardError (Join-Path $challengeDirectory 'worker.stderr.log') -PassThru
[IO.File]::WriteAllText($challengePidFile, "$($challengeStarted.Id)")
Start-Sleep -Milliseconds 500
$challengeStarted.Refresh()
if ($challengeStarted.HasExited) { throw 'Challenge collector exited; inspect its private log.' }
Write-Output 'Read-only challenge collector started; confirm public cloud receipt.'
