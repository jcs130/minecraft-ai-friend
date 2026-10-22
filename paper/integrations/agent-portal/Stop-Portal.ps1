$ErrorActionPreference = 'Stop'
$portalMain = Join-Path $PSScriptRoot 'src\main.mjs'
$pidFile = Join-Path $PSScriptRoot '.local\portal.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Output 'No portal PID recorded.'; exit 0 }
$portalProcessId = [int](Get-Content -LiteralPath $pidFile -Raw)
$portalProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$portalProcessId" -ErrorAction SilentlyContinue
if ($portalProcess -and $portalProcess.CommandLine.Contains($portalMain)) {
    Stop-Process -Id $portalProcessId -ErrorAction Stop
    Write-Output "Stopped only the portal process: PID $portalProcessId"
} elseif ($portalProcess) {
    throw 'Recorded PID belongs to another process; refusing to stop it.'
} else {
    Write-Output 'Portal is already stopped.'
}
Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
