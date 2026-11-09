param([Parameter(Mandatory=$true)][string]$Config, [Parameter(Mandatory=$true)][string]$Node)
$ErrorActionPreference='Stop'
$mapConfig=(Resolve-Path -LiteralPath $Config).Path
$mapRoot=Split-Path -Parent $mapConfig
$mapLease=$null
try {
  try { $mapLease=[IO.File]::Open((Join-Path $mapRoot 'supervisor.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
  catch [IO.IOException] { exit 0 }
  while(-not(Test-Path -LiteralPath (Join-Path $mapRoot 'stop.request'))) {
    & $Node --max-old-space-size=192 (Join-Path $PSScriptRoot 'scripts/sync-world-map.mjs') --config $mapConfig
    if($LASTEXITCODE -eq 0){break}
    Start-Sleep -Seconds 15
  }
} finally { if($mapLease){$mapLease.Dispose()} }
