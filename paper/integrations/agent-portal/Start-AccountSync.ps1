param([Parameter(Mandatory=$true)][string]$SyncConfig)
$ErrorActionPreference = 'Stop'
$syncMain = Join-Path $PSScriptRoot 'scripts/sync-accounts.mjs'
$syncConfigPath = (Resolve-Path -LiteralPath $SyncConfig).Path
$syncStateDir = Split-Path -Parent $syncConfigPath
$syncPidFile = Join-Path $syncStateDir 'accounts-worker.pid'
if (Test-Path -LiteralPath $syncPidFile) {
    $syncProcessId = [int](Get-Content -LiteralPath $syncPidFile -Raw)
    $syncProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$syncProcessId" -ErrorAction SilentlyContinue
    if ($syncProcess -and $syncProcess.CommandLine.Contains($syncMain)) { Write-Output 'Portal account synchronization process already running.'; exit 0 }
}
$syncNode = (Get-Command node -ErrorAction Stop).Source
$syncArgs = '"' + $syncMain + '" --config "' + $syncConfigPath + '"'
$syncStarted = Start-Process -FilePath $syncNode -ArgumentList $syncArgs -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $syncStateDir 'accounts-worker.stdout.log') -RedirectStandardError (Join-Path $syncStateDir 'accounts-worker.stderr.log') -PassThru
[IO.File]::WriteAllText($syncPidFile, "$($syncStarted.Id)")
Start-Sleep -Milliseconds 500
$syncStarted.Refresh()
if ($syncStarted.HasExited) { throw 'Account synchronization exited; inspect the private worker log.' }
Write-Output 'Portal account synchronization process started. Check cloud freshness to confirm successful delivery.'
