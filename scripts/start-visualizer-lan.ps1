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

function Patch-VisualizerViewerLinks {
  param([string]$AppJsPath)

  if (-not (Test-Path -LiteralPath $AppJsPath)) { return }

  $content = [System.IO.File]::ReadAllText($AppJsPath)
  if ($content.Contains('function viewerUrl(port)')) { return }

  $content = $content.Replace('href="http://127.0.0.1:${port}"', 'href="${viewerUrl(port)}"')
  $viewerHelper = @"
function viewerUrl(port) {
  const params = new URLSearchParams(window.location.search);
  const configuredHost = params.get('viewerHost') || state.config?.viewerHost || window.location.hostname || '127.0.0.1';
  const host = configuredHost.includes(':') && !configuredHost.startsWith('[') ? '[' + configuredHost + ']' : configuredHost;
  return 'http://' + host + ':' + port;
}

"@
  $content = $content.Replace('function renderBulletins(bulletins) {', $viewerHelper + 'function renderBulletins(bulletins) {')
  [System.IO.File]::WriteAllText($AppJsPath, $content, [System.Text.UTF8Encoding]::new($false))
}

$node = (Get-Command node -ErrorAction Stop).Source
Patch-VisualizerViewerLinks (Join-Path $visualizerDir "public\app.js")
$env:CONTROL_HOST = $HostAddress
$env:CONTROL_PORT = [string]$Port
Set-Location -LiteralPath $visualizerDir
& $node src/index.js