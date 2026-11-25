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
foreach($lockName in @('controller.lock','maintenance-flow.lock')){
    if(-not $command.Contains("'$lockName'")){throw "Runtime lock exclusion missing: $lockName"}
}
$fixture=Join-Path 'E:\MC\staging' ('resident-backup-lock-'+[guid]::NewGuid().ToString('N'))
$opsDir=Join-Path $fixture 'source'
$opsCopy=Join-Path $fixture 'before'
$opsCopyLog=Join-Path $fixture 'before.log'
New-Item -ItemType Directory -Path $opsDir,$opsCopy -Force|Out-Null
[IO.File]::WriteAllText((Join-Path $opsDir 'persistent-state.json'),'{"preserved":true}')
[IO.File]::WriteAllText((Join-Path $opsDir 'controller.py'),'# persistent controller source')
$leases=@()
try{
    foreach($lockName in @('controller.lock','maintenance-flow.lock')){
        $file=[IO.File]::Open((Join-Path $opsDir $lockName),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite)
        $file.WriteByte(1);$file.Flush();$file.Lock(0,1)
        $leases+=,$file
    }
    # Each missing exclusion must independently reproduce a real locked-file failure.
    foreach($lockName in @('controller.lock','maintenance-flow.lock')){
        $opsCopy=Join-Path $fixture ('before-'+$lockName);$opsCopyLog=Join-Path $fixture ('before-'+$lockName+'.log')
        & ([ScriptBlock]::Create($command.Replace("'$lockName' ",'')))|Out-Null
        if($LASTEXITCODE -lt 8){throw "Fixture did not reproduce the Windows lock failure: $lockName"}
    }
    $opsCopy=Join-Path $fixture 'after';$opsCopyLog=Join-Path $fixture 'after.log'
    & ([ScriptBlock]::Create($command))|Out-Null
    if($LASTEXITCODE -ge 8){throw 'Operations copy failed with resident lock excluded'}
    foreach($name in @('persistent-state.json','controller.py')){
        if((Get-FileHash -LiteralPath (Join-Path $opsDir $name)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $opsCopy $name)).Hash){throw 'Persistent operations state changed'}
    }
    foreach($lockName in @('controller.lock','maintenance-flow.lock')){
        if(Test-Path -LiteralPath (Join-Path $opsCopy $lockName)){throw "Non-restorable runtime lock copied: $lockName"}
    }
    if(-not(Test-Path -LiteralPath $opsCopyLog)){throw 'Operations diagnostic log missing'}
}finally{foreach($file in $leases){$file.Unlock(0,1);$file.Dispose()}}
$global:LASTEXITCODE=0
Write-Output 'Runtime backup locks: both original failures reproduced; fixed copy, two persistent hashes, two lease exclusions, diagnostic log and syntax checks passed (9)'
