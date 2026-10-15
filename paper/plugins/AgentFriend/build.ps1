param(
    [string]$ServerRoot = 'E:\MC\server',
    [ValidateSet('1.20.6', '1.21.1')][string]$MinecraftVersion = '1.21.1'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$java = 'E:\MC\jdk\jdk-21.0.12.1+1\bin\javac.exe'
$jar = 'E:\MC\jdk\jdk-21.0.12.1+1\bin\jar.exe'
$paper = Join-Path $ServerRoot "versions\$MinecraftVersion\paper-$MinecraftVersion.jar"
if (-not (Test-Path -LiteralPath $paper)) { throw "Prepare Paper $MinecraftVersion first, or pass -ServerRoot pointing to the isolated candidate." }
$worldGuard = @(Get-ChildItem -LiteralPath (Join-Path $ServerRoot 'plugins') -Filter 'worldguard-bukkit-*.jar' -File)
if ($worldGuard.Count -ne 1) { throw 'Exactly one enabled WorldGuard JAR is required for a reproducible build.' }
$classpath = @(
    $paper
    Get-ChildItem -LiteralPath (Join-Path $ServerRoot 'libraries') -Recurse -Filter '*.jar' -File | ForEach-Object { $_.FullName }
    Join-Path $ServerRoot 'plugins\MagicSpells-4.0-Beta-15.jar'
    Join-Path $ServerRoot 'plugins\AuraSkills-2.4.0.jar'
    $worldGuard[0].FullName
    Join-Path $ServerRoot 'plugins\worldedit-bukkit-7.3.9.jar'
    Join-Path $ServerRoot 'plugins\EssentialsX-2.22.0.jar'
    Join-Path $ServerRoot 'plugins\ProtocolLib-5.3.0.jar'
) -join ';'
$build = Join-Path $root "build-0.4.42-mc-$MinecraftVersion"
New-Item -ItemType Directory -Path $build -Force | Out-Null
# The isolated server path plus both library generations can exceed Windows'
# command-line limit. A UTF-8 argument file also handles paths containing spaces.
$compileArguments = @('-encoding', 'UTF-8', '-source', '21', '-target', '21', '-cp', $classpath, '-d', $build,
    (Get-Item -LiteralPath (Join-Path $root '..\shared\src\org\afuhome\eye\EyePairs.java')).FullName) +
    @(Get-ChildItem -LiteralPath (Join-Path $root 'src\org\afuhome\agentfriend') -Filter '*.java' -File | ForEach-Object { $_.FullName })
$argumentFile = [System.IO.Path]::GetTempFileName()
try {
    $argumentLines = $compileArguments | ForEach-Object { '"' + $_.Replace('\', '/') + '"' }
    [System.IO.File]::WriteAllLines($argumentFile, [string[]]$argumentLines, [System.Text.UTF8Encoding]::new($false))
    & $java "@$argumentFile"
    $compileExitCode = $LASTEXITCODE
} finally { Remove-Item -LiteralPath $argumentFile -Force }
if ($compileExitCode -ne 0) { throw 'javac failed' }
$pluginYaml = (Get-Content -LiteralPath (Join-Path $root 'resources\plugin.yml') -Raw).Replace("api-version: '1.21.1'", "api-version: '$MinecraftVersion'")
[System.IO.File]::WriteAllText((Join-Path $build 'plugin.yml'), $pluginYaml, [System.Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath (Join-Path $root 'resources\config.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root '..\..\item-appearances\catalog.json') -Destination (Join-Path $build 'item-appearances.json') -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\trial-road.tsv') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\dynamic-board.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\goddess-gifts.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\task-market.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\lands.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\guild-shared-chests.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\trial-waves.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\dungeons.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\professions.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\skills.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\skill-unlocks.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\skill-points.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\skill-assessments.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\life-challenges.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\adventurer-grades.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\world-life.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\trade-directory.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\resident-contracts.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\route-contracts.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\onboarding.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\agent-guide.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\skill-visuals.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\structure-protection.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\text-bubbles.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\photo-camera.yml') -Destination $build -Force
$out = Join-Path $root 'AgentFriend-0.4.42.jar'
& $jar --create --file $out -C $build .
if ($LASTEXITCODE -ne 0) { throw 'jar failed' }
Get-FileHash -LiteralPath $out -Algorithm SHA256 | Select-Object Path,Hash
