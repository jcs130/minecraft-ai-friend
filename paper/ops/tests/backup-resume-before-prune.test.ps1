param([string]$Source = (Join-Path $PSScriptRoot '../manage-server.ps1'))

$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($Source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Invalid maintenance script' }
$backup = $ast.Find({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Backup-Server'
}, $true)
if (-not $backup) { throw 'Backup-Server is absent' }
$cold = $backup.Body.EndBlock.Statements | Where-Object {
    $_ -is [Management.Automation.Language.TryStatementAst] -and $_.Body.Extent.Text.Contains('Backup complete:')
}
$pruning = @($backup.Body.EndBlock.Statements | Where-Object {
    $_.Extent.Text -match '^Prune(?:Release)?Snapshots \$backupRoot$'
})
if (-not $cold.Finally -or $pruning.Count -ne 2 -or
    $cold.Body.Extent.Text -match '(?m)^\s*Prune(?:Release)?Snapshots\s' -or
    $pruning[0].Extent.StartOffset -lt $cold.Extent.EndOffset) {
    throw 'Retention must run after the normal startup and backup failure handling'
}

# Simulate only the cold copy while running the real cleanup and recovery statements.
$tail = [scriptblock]::Create('try { if ($copyFails) { throw "copy failed" } } finally ' +
    $cold.Finally.Extent.Text + [Environment]::NewLine + (($pruning | ForEach-Object Extent | ForEach-Object Text) -join [Environment]::NewLine))
function Start-Server {
    $events.Add('start')
    if ($startFails) { throw 'start failed' }
}
function Remove-Item { param($LiteralPath, [switch]$Force, $ErrorAction) $events.Add('unpause') }
function PruneReleaseSnapshots { $events.Add('release pruning') }
function PruneSnapshots { $events.Add('daily pruning') }
function Log { }

foreach ($case in @(
    @{ running = $true; copy = $false; start = $false; expected = 'start,unpause,release pruning,daily pruning'; failure = '' }
    @{ running = $true; copy = $true;  start = $false; expected = 'start,unpause'; failure = 'copy failed' }
    @{ running = $true; copy = $false; start = $true;  expected = 'start'; failure = 'start failed' }
    @{ running = $false; copy = $false; start = $false; expected = 'unpause,release pruning,daily pruning'; failure = '' }
)) {
    $events = [Collections.Generic.List[string]]::new()
    $wasRunning = $case.running
    $wasPaused = $false
    $startedAgain = $false
    $copyFails = $case.copy
    $startFails = $case.start
    $opsDir = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString('N'))
    $pausedFile = Join-Path $opsDir 'auto-start.paused'
    $backupRoot = Join-Path $opsDir 'mock-backups'
    $errorText = ''
    try { & $tail } catch { $errorText = $_.Exception.Message }
    if (($events -join ',') -cne $case.expected -or $errorText -cne $case.failure) {
        throw "Unexpected backup order $($events -join ',') / $errorText"
    }
}
'Backup restarts before retention (4 isolated lifecycle cases passed)'
