param(
    [Parameter(Mandatory=$true)][string]$ServerDir
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$skinRoot = Join-Path $ServerDir 'plugins\SkinsRestorer\skins'
$recommendations = Join-Path $ServerDir 'plugins\SkinsRestorer\recommendations.json'
if (-not (Test-Path -LiteralPath $skinRoot -PathType Container)) { throw "Skin directory missing: $skinRoot" }
if (-not (Test-Path -LiteralPath $recommendations -PathType Leaf)) { throw "Recommendations missing: $recommendations" }
$source = (Get-Content -LiteralPath $recommendations -Raw | ConvertFrom-Json).skins
$catalog = (Get-Content -LiteralPath (Join-Path $root 'skin-catalog.json') -Raw | ConvertFrom-Json).skins
foreach ($entry in $catalog) {
    $matches = @($source | Where-Object { $_.skinId -eq $entry.sourceId })
    if ($matches.Count -ne 1) { throw "Expected one recommendation for $($entry.sourceId), got $($matches.Count)" }
    $skin = $matches[0]
    if (-not $skin.value -or -not $skin.signature) { throw "Unsigned recommendation: $($entry.sourceId)" }
    $dest = Join-Path $skinRoot ($entry.name + '.customskin')
    $record = [ordered]@{ skinName = $entry.name; value = $skin.value; signature = $skin.signature; dataVersion = 1 }
    $record | ConvertTo-Json -Compress | Set-Content -LiteralPath $dest -Encoding utf8NoBOM
    Write-Host "$($entry.name) <- $($entry.sourceId)"
}
