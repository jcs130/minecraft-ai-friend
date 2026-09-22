# Existing daily backup entry point. Never prune history or merge into an old snapshot.
param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Project = 'D:\Projects\QiandengJi'
$World = Join-Path $Project 'server\mc\shadow'
$Secret = Join-Path $Project 'server\world-data\rcon-secret.txt'
$Python = 'C:\Python314\python.exe'
$DestinationRoot = 'D:\backups\mc-neoforge-auto'
$Client = Join-Path $Project 'world\survival\numen_gateway.py'
foreach ($file in @($Python, $Client, $Secret, (Join-Path $World 'level.dat'))) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing required file: $file" }
}
if (-not (Test-Path -LiteralPath $DestinationRoot -PathType Container)) { throw 'Backup root missing' }
$Robocopy = (Get-Command robocopy.exe -CommandType Application).Source
$Name = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHHmmss.fffffffZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$Destination = Join-Path $DestinationRoot $Name
$Plan = [ordered]@{source=$World; destination=$Destination; rcon='127.0.0.1:25577'; secretFile=$Secret;
    python=$Python; client=$Client; deletesHistory=$false; offlineFallback=$false; checkOnly=[bool]$CheckOnly}
if ($CheckOnly) { $Plan | ConvertTo-Json; return }

# ASCII and no double quotes: safe as one -c argument with Windows PowerShell 5.1.
$RconCode = @'
import json, sys
from pathlib import Path
sys.path.insert(0, 'D:/Projects/QiandengJi/world/survival')
from numen_gateway import RconClient
assert sys.argv[1] in {'save-off', 'save-all flush', 'save-on'}
try:
    reply = RconClient(host='127.0.0.1', port=25577, secret=Path('D:/Projects/QiandengJi/server/world-data/rcon-secret.txt')).cmd(sys.argv[1])
except Exception:
    print('RCON failed; command outcome may be unknown')
    sys.exit(1)
print(json.dumps({'reply': reply}))
'@
function Invoke-BackupRcon([string]$Command) {
    $output = & $Python -I -B -c $RconCode $Command
    if ($LASTEXITCODE -ne 0) { throw "RCON $Command failed; outcome may be unknown; do not replay automatically" }
    return [string](($output -join "`n" | ConvertFrom-Json).reply).Trim()
}

# New-Item without -Force refuses any existing destination, including a concurrent collision.
$null = New-Item -ItemType Directory -Path $Destination
$ReceiptPath = Join-Path $Destination 'backup-receipt.json'
$Receipt = [ordered]@{schema=1; plan=$Plan; status='running'; phase='created'; saveOff='not_sent';
    saveOn='not_sent'; replies=[ordered]@{}; robocopyExitCode=$null; error=$null}
function Save-Receipt {
    [IO.File]::WriteAllText($ReceiptPath, ($Receipt | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
}
$Owned = $false
$Failure = $null
try {
    $Receipt.phase = 'save_off'; $Receipt.saveOff = 'unknown'; Save-Receipt
    $reply = Invoke-BackupRcon 'save-off'; $Receipt.replies['save-off'] = $reply
    if ($reply -eq 'Saving is already turned off') {
        $Receipt.saveOff = 'already_off'; throw 'Saving was already off; ownership not acquired; backup refused'
    }
    if ($reply -ne 'Automatic saving is now disabled') { throw 'Unexpected save-off response; ownership unknown' }
    $Owned = $true; $Receipt.saveOff = 'owned'; $Receipt.phase = 'flush'; Save-Receipt
    $reply = Invoke-BackupRcon 'save-all flush'; $Receipt.replies['save-all flush'] = $reply
    if ($reply -notmatch '(?s)^(Saving the game \(this may take a moment!\)\s*)?Saved the game$') { throw 'Flush not confirmed' }
    $Receipt.phase = 'copy'; Save-Receipt
    & $Robocopy $World (Join-Path $Destination 'world') /E /COPY:DAT /DCOPY:T /XJ /NFL /NDL /NJH /NP /R:1 /W:2 | Out-Null
    $Receipt.robocopyExitCode = $LASTEXITCODE
    if ($LASTEXITCODE -lt 0 -or $LASTEXITCODE -ge 8) { throw "Robocopy failed: $LASTEXITCODE" }
    if (-not (Test-Path -LiteralPath (Join-Path $Destination 'world\level.dat') -PathType Leaf)) { throw 'Copied level.dat missing' }
} catch {
    $Failure = $_.Exception.Message
} finally {
    if ($Owned) {
        # Record failure must not prevent the one save-on attempt after our confirmed save-off.
        $Receipt.phase = 'save_on'; $Receipt.saveOn = 'unknown'
        try { Save-Receipt } catch { $Failure = "Receipt write failed; $Failure" }
        try {
            $reply = Invoke-BackupRcon 'save-on'; $Receipt.replies['save-on'] = $reply
            if ($reply -ne 'Automatic saving is now enabled') { throw 'Save-on not confirmed; inspect server saving state' }
            $Receipt.saveOn = 'confirmed'
        } catch { $Failure = "$Failure Save-on failed or unknown; inspect server saving state" }
    }
}
$Receipt.phase = 'finished'; $Receipt.error = $Failure
$Receipt.status = if ($Failure) { 'failed' } else { 'complete' }
Save-Receipt
if ($Failure) { throw $Failure }
$Receipt | ConvertTo-Json -Depth 6
