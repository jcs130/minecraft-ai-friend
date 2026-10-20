$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '../manage-server.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Maintenance script does not parse'}
$commands=@($ast.FindAll({param($node)
    $node -is [Management.Automation.Language.CommandAst] -and
    $node.GetCommandName() -eq 'robocopy.exe' -and $node.Extent.Text.Contains('$opsDir $opsCopy')
},$true))
if($commands.Count -ne 1){throw 'Expected one operations-copy command'}
$command=$commands[0].Extent.Text
if(-not $command.Contains("'controller.lock'")){throw 'Resident lock exclusion missing'}
$fixture=Join-Path 'E:\MC\staging' ('resident-backup-lock-'+[guid]::NewGuid().ToString('N'))
$opsDir=Join-Path $fixture 'source'
$opsCopy=Join-Path $fixture 'before'
$opsCopyLog=Join-Path $fixture 'before.log'
New-Item -ItemType Directory -Path $opsDir,$opsCopy -Force|Out-Null
[IO.File]::WriteAllText((Join-Path $opsDir 'persistent-state.json'),'{"preserved":true}')
[IO.File]::WriteAllText((Join-Path $opsDir 'controller.py'),'# persistent controller source')
$file=[IO.File]::Open((Join-Path $opsDir 'controller.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite)
try{
    $file.WriteByte(1);$file.Flush();$file.Lock(0,1)
    # Positive control: the original command must really fail on the held lock.
    & ([ScriptBlock]::Create($command.Replace("'controller.lock' ",'')))|Out-Null
    if($LASTEXITCODE -lt 8){throw 'Fixture did not reproduce the Windows lock failure'}
    $opsCopy=Join-Path $fixture 'after';$opsCopyLog=Join-Path $fixture 'after.log'
    & ([ScriptBlock]::Create($command))|Out-Null
    if($LASTEXITCODE -ge 8){throw 'Operations copy failed with resident lock excluded'}
    foreach($name in @('persistent-state.json','controller.py')){
        if((Get-FileHash -LiteralPath (Join-Path $opsDir $name)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $opsCopy $name)).Hash){throw 'Persistent operations state changed'}
    }
    if(Test-Path -LiteralPath (Join-Path $opsCopy 'controller.lock')){throw 'Non-restorable resident lock copied'}
    if(-not(Test-Path -LiteralPath $opsCopyLog)){throw 'Operations diagnostic log missing'}
}finally{$file.Unlock(0,1);$file.Dispose()}
Write-Output 'Resident backup lock: original failure reproduced; fixed copy, two persistent hashes, lease exclusion, diagnostic log and syntax checks passed (7)'
