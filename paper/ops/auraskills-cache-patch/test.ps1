[CmdletBinding()]
param(
    [string]$AuraJar = 'E:\MC\server\plugins\AuraSkills-2.4.0.jar',
    [string]$Jdk = 'E:\MC\jdk\jdk-21.0.12.1+1',
    [string]$OutputDirectory = 'E:\MC\ops\repairs\performance-20261004\patch-build'
)
$ErrorActionPreference = 'Stop'
$java = Join-Path $Jdk 'bin\java.exe'
$patchJar = Join-Path $OutputDirectory 'auraskills-cache-patch.jar'
$fixture = Join-Path $OutputDirectory 'fixture'
$launcher = Join-Path $OutputDirectory 'launcher'
$testRoot = Join-Path $OutputDirectory ('test-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
function Wait-TestFile([string]$path, [int]$seconds = 35) {
    $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
    while (-not (Test-Path -LiteralPath $path)) {
        if ([DateTime]::UtcNow -gt $deadline) { throw "Timeout waiting for $path" }
        Start-Sleep -Milliseconds 50
    }
}
function Read-TestReceipt([string]$path) {
    Wait-TestFile $path
    $receipt = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if (-not $receipt.success) { throw "Test failed: $(Get-Content -LiteralPath $path -Raw)" }
    return $receipt
}
function Send-Phase([string]$directory, [string]$number, [string]$phase) {
    [System.IO.File]::WriteAllText((Join-Path $directory 'command.txt'), "$($number):$phase")
    Read-TestReceipt (Join-Path $directory "phase-$number.json")
}
function Attach-Test([string]$targetPid, [string]$mode, [string]$name) {
    $receipt = Join-Path $testRoot "$name.json"
    $attachOutput = & $java --add-modules jdk.attach -jar $patchJar --pid $targetPid --agent $patchJar --mode $mode --result $receipt
    if ($LASTEXITCODE -ne 0) { throw "Attach $mode failed" }
    Read-TestReceipt $receipt
}
$checks = [ordered]@{}
$hotDirectory = Join-Path $testRoot 'hot'
New-Item -ItemType Directory -Path $hotDirectory | Out-Null
$fixtureArguments = @('-Xms32m', '-Xmx128m', '-cp', ('"' + $launcher + '"'), 'FixtureLauncher', ('"' + $fixture + '"'), ('"' + $AuraJar + '"'), ('"' + $hotDirectory + '"'))
$target = Start-Process -FilePath $java -ArgumentList $fixtureArguments -WorkingDirectory $testRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot 'hot.stdout.log') -RedirectStandardError (Join-Path $testRoot 'hot.stderr.log')
try {
    Wait-TestFile (Join-Path $hotDirectory 'ready.txt')
    $targetPid = (Get-Content -LiteralPath (Join-Path $hotDirectory 'ready.txt') -Raw).Trim()
    if ($targetPid -ne [string]$target.Id) { throw 'Fixture PID mismatch' }
    $checks.baseline = Send-Phase $hotDirectory '1' 'baseline'
    $checks.fix = Attach-Test $targetPid 'fix' 'attach-fix'
    $checks.fixed = Send-Phase $hotDirectory '2' 'fixed'
    $checks.rollback = Attach-Test $targetPid 'rollback' 'attach-rollback'
    $checks.rolledBack = Send-Phase $hotDirectory '3' 'rollback'
    $checks.reapply = Attach-Test $targetPid 'fix' 'attach-reapply'
    $checks.fixedAgain = Send-Phase $hotDirectory '4' 'fixed'
} finally {
    [System.IO.File]::WriteAllText((Join-Path $hotDirectory 'command.txt'), '5:stop')
    if (-not $target.WaitForExit(5000)) { Stop-Process -Id $target.Id }
}
$bootDirectory = Join-Path $testRoot 'boot'
New-Item -ItemType Directory -Path $bootDirectory | Out-Null
$bootReceipt = Join-Path $testRoot 'premain.json'
$bootArguments = @('-Xms32m', '-Xmx128m', ('"-javaagent:' + $patchJar + '=mode=fix;result=' + $bootReceipt + '"'), '-cp', ('"' + $launcher + '"'), 'FixtureLauncher', ('"' + $fixture + '"'), ('"' + $AuraJar + '"'), ('"' + $bootDirectory + '"'))
$boot = Start-Process -FilePath $java -ArgumentList $bootArguments -WorkingDirectory $testRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot 'boot.stdout.log') -RedirectStandardError (Join-Path $testRoot 'boot.stderr.log')
try {
    Wait-TestFile (Join-Path $bootDirectory 'ready.txt')
    $deadline = [DateTime]::UtcNow.AddSeconds(35)
    do {
        Start-Sleep -Milliseconds 100
        $startup = Get-Content -LiteralPath $bootReceipt -Raw | ConvertFrom-Json
        if ([DateTime]::UtcNow -gt $deadline) { throw "Startup verification timeout: $startup" }
    } while (-not $startup.success)
    $checks.premain = $startup
    $checks.bootFixed = Send-Phase $bootDirectory '1' 'fixed'
    $bootPid = (Get-Content -LiteralPath (Join-Path $bootDirectory 'ready.txt') -Raw).Trim()
    $checks.bootRollback = Attach-Test $bootPid 'rollback' 'boot-rollback'
    $checks.bootRolledBack = Send-Phase $bootDirectory '2' 'rollback'
} finally {
    [System.IO.File]::WriteAllText((Join-Path $bootDirectory 'command.txt'), '3:stop')
    if (-not $boot.WaitForExit(5000)) { Stop-Process -Id $boot.Id }
}
$rejectedJar = Join-Path $testRoot 'AuraSkills-2.4.0-rejected.jar'
Copy-Item -LiteralPath $AuraJar -Destination $rejectedJar
Add-Type -AssemblyName System.IO.Compression.FileSystem
$rejectedArchive = [System.IO.Compression.ZipFile]::Open($rejectedJar, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    $marker = $rejectedArchive.CreateEntry('test-only-rejected-pin.txt')
    $writer = [System.IO.StreamWriter]::new($marker.Open())
    try { $writer.Write('Independent negative test; original classes unchanged, whole JAR pin must reject this file.') } finally { $writer.Dispose() }
} finally { $rejectedArchive.Dispose() }
$rejectDirectory = Join-Path $testRoot 'reject'
New-Item -ItemType Directory -Path $rejectDirectory | Out-Null
$rejectReceipt = Join-Path $testRoot 'rejected-premain.json'
$rejectArguments = @('-Xms32m', '-Xmx128m', ('"-javaagent:' + $patchJar + '=mode=fix;result=' + $rejectReceipt + '"'), '-cp', ('"' + $launcher + '"'), 'FixtureLauncher', ('"' + $fixture + '"'), ('"' + $rejectedJar + '"'), ('"' + $rejectDirectory + '"'))
$reject = Start-Process -FilePath $java -ArgumentList $rejectArguments -WorkingDirectory $testRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot 'reject.stdout.log') -RedirectStandardError (Join-Path $testRoot 'reject.stderr.log')
try {
    Wait-TestFile (Join-Path $rejectDirectory 'ready.txt')
    $rejectedStartup = Get-Content -LiteralPath $rejectReceipt -Raw | ConvertFrom-Json
    if ($rejectedStartup.success -or $rejectedStartup.phase -ne 'startup-skipped' -or $rejectedStartup.error -notlike '*SHA256*') { throw 'Unpinned JAR was not rejected on startup' }
    $checks.rejectedStartup = $rejectedStartup
    $checks.unpinnedKeepsOriginal = Send-Phase $rejectDirectory '1' 'baseline'
    $rejectPid = (Get-Content -LiteralPath (Join-Path $rejectDirectory 'ready.txt') -Raw).Trim()
    $rejectedAttachPath = Join-Path $testRoot 'rejected-attach.json'
    $rejectedAttachOutput = & $java --add-modules jdk.attach -jar $patchJar --pid $rejectPid --agent $patchJar --mode fix --result $rejectedAttachPath
    if ($LASTEXITCODE -eq 0) { throw 'Unpinned online target was not rejected' }
    $rejectedAttach = Get-Content -LiteralPath $rejectedAttachPath -Raw | ConvertFrom-Json
    if ($rejectedAttach.success -or $rejectedAttach.error -notlike '*SHA256*') { throw 'Missing explicit online pin refusal' }
    $checks.rejectedAttach = $rejectedAttach
    $checks.unpinnedStillOriginal = Send-Phase $rejectDirectory '2' 'baseline'
} finally {
    [System.IO.File]::WriteAllText((Join-Path $rejectDirectory 'command.txt'), '3:stop')
    if (-not $reject.WaitForExit(5000)) { Stop-Process -Id $reject.Id }
}
[ordered]@{ success = $true; target = 'Independent 128MB JVM with actual official MessageKey/LocalizedKey and test-only Bukkit scheduler'; testRoot = $testRoot; checks = $checks } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $testRoot 'summary.json') -Encoding utf8
Get-Content -LiteralPath (Join-Path $testRoot 'summary.json')
