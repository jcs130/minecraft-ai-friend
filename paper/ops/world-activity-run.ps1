param(
    [Parameter(Mandatory=$true)][string]$Python,
    [string]$OpsRoot = 'E:\MC\ops',
    [string]$Server = 'E:\MC\server'
)
$ErrorActionPreference = 'Stop'
$activityMutex = [Threading.Mutex]::new($false, 'Local\Qiandengji-WorldActivity')
$activityAcquired = $false
try {
    try { $activityAcquired = $activityMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $activityAcquired = $true }
    if (-not $activityAcquired) { exit 0 }
    $activityState = Join-Path $OpsRoot 'state\world-activity'
    New-Item -ItemType Directory -Path $activityState -Force | Out-Null
    $activityStart = [DateTime]::UtcNow
    try {
        $activityResult = & $Python -X utf8 (Join-Path $OpsRoot 'world-activity.py') --server $Server --out (Join-Path $activityState 'snapshot.json') 2>&1
        if ($LASTEXITCODE -ne 0) { throw "collector exited $LASTEXITCODE" }
        $activitySummary = ($activityResult -join "`n") | ConvertFrom-Json
        $activityHealth = @{status='ok'; observedAt=$activitySummary.observedAt; durationMs=[int]([DateTime]::UtcNow-$activityStart).TotalMilliseconds; available=$activitySummary.available}
    } catch {
        # Previous snapshot stays intact; consumers must check observedAt freshness.
        $activityHealth = @{status='error'; observedAt=[DateTime]::UtcNow.ToString('o'); reason=$_.Exception.Message.Substring(0,[Math]::Min(300,$_.Exception.Message.Length))}
    }
    [IO.File]::WriteAllText((Join-Path $activityState 'health.json'), ($activityHealth | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    if ($activityHealth.status -ne 'ok') { exit 1 }
} finally {
    if ($activityAcquired) { $activityMutex.ReleaseMutex() }
    $activityMutex.Dispose()
}
