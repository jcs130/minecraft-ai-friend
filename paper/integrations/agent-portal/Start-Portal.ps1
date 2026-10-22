param([ValidateRange(1, 65535)][int]$Port = 8790, [string]$ListenAddress = '127.0.0.1')
$ErrorActionPreference = 'Stop'
$portalRoot = $PSScriptRoot
$portalMain = Join-Path $portalRoot 'src\main.mjs'
$localDir = Join-Path $portalRoot '.local'
New-Item -ItemType Directory -Path $localDir -Force | Out-Null
$pidFile = Join-Path $localDir 'portal.pid'
if (Test-Path -LiteralPath $pidFile) {
    $existingId = [int](Get-Content -LiteralPath $pidFile -Raw)
    $existingProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$existingId" -ErrorAction SilentlyContinue
    if ($existingProcess -and $existingProcess.CommandLine.Contains($portalMain)) {
        $listening = Get-NetTCPConnection -OwningProcess $existingId -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $listening) { throw 'The portal process exists but is not listening. Check .local/portal.stderr.log.' }
        Write-Output "Portal already running: PID $existingId"
        Write-Output "http://127.0.0.1:$($listening.LocalPort)"
        exit 0
    }
}
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
    throw "Port $Port is already occupied. No existing process was stopped."
}
$nodePath = (Get-Command node -ErrorAction Stop).Source
$previousPort = $env:PORTAL_PORT
$previousListenAddress = $env:PORTAL_HOST
$previousPrivateBind = $env:PORTAL_ALLOW_PRIVATE_BIND
try {
    $env:PORTAL_PORT = "$Port"
    $env:PORTAL_HOST = $ListenAddress
    if ($ListenAddress -notin @('127.0.0.1','::1','localhost')) { $env:PORTAL_ALLOW_PRIVATE_BIND = '1' }
    $portalArguments = '"' + $portalMain + '"'
    $portalProcess = Start-Process -FilePath $nodePath -ArgumentList $portalArguments -WorkingDirectory $portalRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $localDir 'portal.stdout.log') -RedirectStandardError (Join-Path $localDir 'portal.stderr.log') -PassThru
    [System.IO.File]::WriteAllText($pidFile, "$($portalProcess.Id)")
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $portalProcess.Refresh()
        if ($portalProcess.HasExited) { break }
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 1
            if ($health.ok) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 100 }
    }
    if (-not $ready) {
        $portalProcess.Refresh()
        if (-not $portalProcess.HasExited) { Stop-Process -Id $portalProcess.Id }
        Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
        throw 'The portal did not become ready. Check .local/portal.stderr.log.'
    }
    Write-Output "Portal started and checked: PID $($portalProcess.Id)"
    Write-Output "http://127.0.0.1:$Port"
} finally {
    $env:PORTAL_PORT = $previousPort
    $env:PORTAL_HOST = $previousListenAddress
    $env:PORTAL_ALLOW_PRIVATE_BIND = $previousPrivateBind
}
