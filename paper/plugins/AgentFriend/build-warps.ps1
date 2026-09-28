param(
    [string]$ManifestPath = 'E:\MC\ops\public-waypoints.json',
    [string]$OutputDir = 'E:\MC\extensions\AgentFriend\warps'
)

$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$worldUuid = [Guid]::Parse($manifest.productionWorldUuid).ToString()
$ids = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$culture = [Globalization.CultureInfo]::InvariantCulture
$encoding = [Text.UTF8Encoding]::new($false)
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

foreach ($place in $manifest.places) {
    $id = [string]$place.id
    if ($id -notmatch '^[a-z_]{1,24}$' -or -not $ids.Add($id)) {
        throw "Invalid or duplicate public waypoint ID: $id"
    }
    $x = ([double]$place.x).ToString('0.0####', $culture)
    $y = ([double]$place.y).ToString('0.0####', $culture)
    $z = ([double]$place.z).ToString('0.0####', $culture)
    $yaml = "world: $worldUuid`nworld-name: $($manifest.world)`nx: $x`ny: $y`nz: $z`nyaw: 0.0`npitch: 0.0`nname: $id`nlastowner: 9ad939f0-c56e-3b7b-ba68-e359b67af0c5`n"
    [IO.File]::WriteAllText((Join-Path $OutputDir "$id.yml"), $yaml, $encoding)
}

Write-Host "Built $($ids.Count) Essentials warp files in $OutputDir"
