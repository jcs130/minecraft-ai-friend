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

function Patch-VisualizerLocalization {
  param([string]$VisualizerDir)

  $publicDir = Join-Path $VisualizerDir "public"
  $localizeSource = Join-Path $root "scripts\visualizer-localize.js"
  $localizeTarget = Join-Path $publicDir "localize.js"
  if (Test-Path -LiteralPath $localizeSource) {
    Copy-Item -LiteralPath $localizeSource -Destination $localizeTarget -Force
  }

  $indexPath = Join-Path $publicDir "index.html"
  if (Test-Path -LiteralPath $indexPath) {
    $content = [System.IO.File]::ReadAllText($indexPath)
    $content = $content.Replace('<title>Minecraft AI 小队控制台</title>', '<title>我的世界 AI 村庄直播台</title>')
    $content = $content.Replace('<h1>Minecraft AI 小队</h1>', '<h1>我的世界 AI 小队</h1>')
    $content = $content.Replace('<span id="modeBadge" class="badge">runtime</span>', '<span id="modeBadge" class="badge">运行环境</span>')
    $content = $content.Replace('<span id="connectionBadge" class="badge ok">live</span>', '<span id="connectionBadge" class="badge ok">在线</span>')
    $content = $content.Replace('<span>Minecraft 模式</span>', '<span>实机视角</span>')
    if (-not $content.Contains('/localize.js')) {
      $content = $content.Replace('    <script type="module" src="/app.js"></script>', "    <script type=`"module`" src=`"/app.js`"></script>`r`n    <script src=`"/localize.js`" defer></script>")
    }
    [System.IO.File]::WriteAllText($indexPath, $content, [System.Text.UTF8Encoding]::new($false))
  }

  $stylePath = Join-Path $publicDir "styles.css"
  if (Test-Path -LiteralPath $stylePath) {
    $content = [System.IO.File]::ReadAllText($stylePath)
    $content = $content.Replace('  text-transform: uppercase;', '  text-transform: none;')
    [System.IO.File]::WriteAllText($stylePath, $content, [System.Text.UTF8Encoding]::new($false))
  }
}

$node = (Get-Command node -ErrorAction Stop).Source
Patch-VisualizerViewerLinks (Join-Path $visualizerDir "public\app.js")
Patch-VisualizerLocalization $visualizerDir
$obsPatch = Join-Path $root "scripts\patch-visualizer-obs.js"
if (Test-Path -LiteralPath $obsPatch) {
  & $node $obsPatch $visualizerDir
}
$studioPatch = Join-Path $root "scripts\patch-visualizer-studio.js"
if (Test-Path -LiteralPath $studioPatch) {
  & $node $studioPatch $visualizerDir
}
$env:CONTROL_HOST = $HostAddress
$env:CONTROL_PORT = [string]$Port
Set-Location -LiteralPath $visualizerDir
& $node src/index.js
