param([string]$MaintenanceScript=(Join-Path $PSScriptRoot '../ops/manage-server.ps1'))
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($MaintenanceScript,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Maintenance script parse failed'}
$function=@($ast.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -eq 'Backup-TreeBytes'})
if($function.Count -ne 1){throw 'Expected the size helper exactly once'}
Invoke-Expression $function[0].Extent.Text
$copyFunction=@($ast.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -eq 'Backup-CopyBytes'})
if($copyFunction.Count -ne 1){throw 'Expected the native copier size helper exactly once'}
Invoke-Expression $copyFunction[0].Extent.Text
$temporaryRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$fixture=Join-Path $temporaryRoot ('qiandengji-backup-long-path-'+[Guid]::NewGuid().ToString('N'))
$deep=$fixture
foreach($i in 1..4){$deep=Join-Path $deep ('segment-'+('a'*60))}
if($deep.Length -le 260){throw 'Fixture must exceed MAX_PATH'}
try {
    $null=[IO.Directory]::CreateDirectory(('\\?\'+$deep))
    [IO.File]::WriteAllBytes(('\\?\'+(Join-Path $fixture 'short.bin')),[byte[]](1,2,3))
    [IO.File]::WriteAllBytes(('\\?\'+(Join-Path $deep 'deep.bin')),[byte[]](4,5,6,7,8))
    if((Backup-TreeBytes $fixture) -ne 8){throw 'Short and deep files must both contribute'}
    if((Backup-CopyBytes $fixture) -ne 8){throw 'Copier preflight must include long paths'}
    $archive=Join-Path $fixture 'repairs'
    New-Item -ItemType Directory -Path $archive|Out-Null
    $archiveFile=Join-Path $archive 'old-release.bin'
    [IO.File]::WriteAllBytes($archiveFile,[byte[]]::new(1024))
    if((Backup-CopyBytes $fixture) -ne 1032){throw 'Full scan ignored the archive'}
    if((Backup-CopyBytes $fixture @($archive)) -ne 8){throw 'Daily sizing still counts excluded maintenance archives'}
    Remove-Item -LiteralPath $archiveFile
    $shortTarget=Join-Path $fixture 'short-target';New-Item -ItemType Directory -Path $shortTarget|Out-Null
    [IO.File]::WriteAllBytes((Join-Path $shortTarget 'five.bin'),[byte[]](1,2,3,4,5))
    $link=Join-Path $fixture 'alias';New-Item -ItemType Junction -Path $link -Target $shortTarget|Out-Null
    if((Backup-CopyBytes $fixture) -ne 18){throw 'Copier preflight must account for materialized junction contents'}
    if($LASTEXITCODE -ne 0){throw 'Successful copier preflight must not leak robocopy exit code 1'}
    # Remove only the fixture junction itself, never its target contents.
    [IO.Directory]::Delete($link)
    $missingRejected=$false
    try {Backup-TreeBytes (Join-Path $fixture 'missing')|Out-Null} catch {$missingRejected=$true}
    if(-not $missingRejected){throw 'Missing directories must not be silently omitted'}
    $uncRejected=$false
    try {Backup-TreeBytes '\\invalid-backup-host\share'|Out-Null} catch {$uncRejected=$true}
    if(-not $uncRejected){throw 'Unexpected network roots must be rejected'}
    Write-Output '8 backup path checks passed, including deep files, exclusion sizing, and junction traversal.'
} finally {
    $resolved=[IO.Path]::GetFullPath($fixture)
    if(-not $resolved.StartsWith(($temporaryRoot+'\'),[StringComparison]::OrdinalIgnoreCase) -or
       [IO.Path]::GetFileName($resolved) -notmatch '^qiandengji-backup-long-path-[a-f0-9]{32}$') {throw 'Unsafe temporary cleanup path'}
    if([IO.Directory]::Exists(('\\?\'+$resolved))){Remove-Item -LiteralPath ('\\?\'+$resolved) -Recurse -Force}
}
