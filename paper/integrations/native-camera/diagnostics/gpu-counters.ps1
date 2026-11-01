param([Parameter(Mandatory=$true)][int]$TargetPid)
$ErrorActionPreference = 'Stop'
# CIM class names are language-independent. Preserve LUID/phys instance names;
# do not label every GPU row Intel or confuse the collector's PID with Java's.
while ($true) {
    try {
        $rows = @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory |
            Where-Object { $_.Name -match ('^pid_' + $TargetPid + '_') } |
            ForEach-Object { @{instance=$_.Name; sharedBytes=[long]$_.SharedUsage; dedicatedBytes=[long]$_.DedicatedUsage; totalCommittedBytes=[long]$_.TotalCommitted} })
        @{atMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); pid=$TargetPid; available=($rows.Count -gt 0); rows=$rows} | ConvertTo-Json -Compress -Depth 4
    } catch {
        @{atMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); pid=$TargetPid; available=$false; error=$_.Exception.GetType().FullName} | ConvertTo-Json -Compress
    }
    if (-not (Get-Process -Id $TargetPid -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 1000
}
