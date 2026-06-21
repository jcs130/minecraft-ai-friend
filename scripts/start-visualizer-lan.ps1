param(
  [string]$HostAddress = "0.0.0.0",
  [int]$Port = 3010
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$visualizerDir = Join-Path $root "references\minecraft-agent-live-visualizer\minecraft-agent-live-visualizer"
if (-not (Test-Path -LiteralPath (Join-Path $visualizerDir "src\index.js"))) {
  throw "Visualizer source not found: $visualizerDir"
}

$node = (Get-Command node -ErrorAction Stop).Source
$env:CONTROL_HOST = $HostAddress
$env:CONTROL_PORT = [string]$Port
Set-Location -LiteralPath $visualizerDir
& $node src/index.js