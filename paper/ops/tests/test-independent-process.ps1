param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputDirectory){throw 'Use a fresh, isolated fixture directory'}
$target=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $target|Out-Null
$ops=Split-Path -Parent $PSScriptRoot
foreach($name in @('IndependentProcess.cs','independent-process.ps1')){Copy-Item -LiteralPath (Join-Path $ops $name) -Destination $target}
foreach($name in @('heartbeat.ps1','fixture-parent.ps1','test-lifecycle.ps1')){Copy-Item -LiteralPath (Join-Path (Join-Path $PSScriptRoot 'independent-process') $name) -Destination $target}
& (Join-Path $target 'test-lifecycle.ps1')
