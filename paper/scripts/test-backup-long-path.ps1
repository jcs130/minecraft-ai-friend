param([string]$MaintenanceScript=(Join-Path $PSScriptRoot '../ops/manage-server.ps1'))
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($MaintenanceScript,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Maintenance script parse failed'}
$function=@($ast.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -eq 'Backup-TreeBytes'})
if($function.Count -ne 1){throw 'Expected the size helper exactly once'}
Invoke-Expression $function[0].Extent.Text
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
    $missingRejected=$false
    try {Backup-TreeBytes (Join-Path $fixture 'missing')|Out-Null} catch {$missingRejected=$true}
    if(-not $missingRejected){throw 'Missing directories must not be silently omitted'}
    $uncRejected=$false
    try {Backup-TreeBytes '\\invalid-backup-host\share'|Out-Null} catch {$uncRejected=$true}
    if(-not $uncRejected){throw 'Unexpected network roots must be rejected'}
    Write-Output '3 backup path checks passed: deep contents, missing path, local root boundary.'
} finally {
    $resolved=[IO.Path]::GetFullPath($fixture)
    if(-not $resolved.StartsWith(($temporaryRoot+'\'),[StringComparison]::OrdinalIgnoreCase) -or
       [IO.Path]::GetFileName($resolved) -notmatch '^qiandengji-backup-long-path-[a-f0-9]{32}$') {throw 'Unsafe temporary cleanup path'}
    if([IO.Directory]::Exists(('\\?\'+$resolved))){Remove-Item -LiteralPath ('\\?\'+$resolved) -Recurse -Force}
}
