param(
    [string]$ServerRoot = 'E:\MC\server',
    [ValidateSet('1.20.6', '1.21.1')][string]$MinecraftVersion = '1.21.1',
    [string]$TabJar = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$java = 'E:\MC\jdk\jdk-21.0.12.1+1\bin\javac.exe'
$jar = 'E:\MC\jdk\jdk-21.0.12.1+1\bin\jar.exe'
$paper = Join-Path $ServerRoot "versions\$MinecraftVersion\paper-$MinecraftVersion.jar"
if (-not (Test-Path -LiteralPath $paper)) { throw "Prepare Paper $MinecraftVersion first, or pass -ServerRoot pointing to the isolated candidate." }
$worldGuard = @(Get-ChildItem -LiteralPath (Join-Path $ServerRoot 'plugins') -Filter 'worldguard-bukkit-*.jar' -File)
if ($worldGuard.Count -ne 1) { throw 'Exactly one enabled WorldGuard JAR is required for a reproducible build.' }
$worldEdit = @(Get-ChildItem -LiteralPath (Join-Path $ServerRoot 'plugins') -File | Where-Object { $_.Name -match '^(worldedit-bukkit-|FastAsyncWorldEdit(?:-Paper)?-).*\.jar$' })
if ($worldEdit.Count -ne 1) { throw 'Exactly one enabled WorldEdit or FastAsyncWorldEdit JAR is required.' }
if (-not $TabJar) {
    $tabCandidates = @(Get-ChildItem -LiteralPath (Join-Path $ServerRoot 'plugins') -Filter 'TAB*.jar' -File)
    if ($tabCandidates.Count -ne 1) { throw 'Supply -TabJar with the official TAB 6.2.1 Paper API JAR (runtime integration is optional).' }
    $TabJar = $tabCandidates[0].FullName
}
if (-not (Test-Path -LiteralPath $TabJar -PathType Leaf)) { throw 'TAB compile dependency is missing.' }
$classpath = @(
    $TabJar
    $paper
    Get-ChildItem -LiteralPath (Join-Path $ServerRoot 'libraries') -Recurse -Filter '*.jar' -File | ForEach-Object { $_.FullName }
    Join-Path $ServerRoot 'plugins\MagicSpells-4.0-Beta-15.jar'
    Join-Path $ServerRoot 'plugins\AuraSkills-2.4.0.jar'
    $worldGuard[0].FullName
    $worldEdit[0].FullName
    Join-Path $ServerRoot 'plugins\EssentialsX-2.22.0.jar'
    Join-Path $ServerRoot 'plugins\SkinsRestorer.jar'
    Join-Path $ServerRoot 'plugins\ProtocolLib-5.3.0.jar'
) -join ';'
$build = Join-Path $root "build-0.4.48-mc-$MinecraftVersion"
New-Item -ItemType Directory -Path $build -Force | Out-Null
# Removed inner classes must not leak from an earlier incremental build into
# a release (e.g. the abandoned void-map generator). Only delete class files
# in this exact build directory; resources are refreshed below.
$resolvedBuild = [IO.Path]::GetFullPath($build).TrimEnd('\')
$expectedBuild = [IO.Path]::GetFullPath((Join-Path $root "build-0.4.48-mc-$MinecraftVersion")).TrimEnd('\')
if ($resolvedBuild -ne $expectedBuild -or (Get-Item -LiteralPath $resolvedBuild).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe class output directory' }
if (Get-ChildItem -LiteralPath $resolvedBuild -Recurse -Force | Where-Object { $_.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint) }) { throw 'Build directory contains a reparse point' }
$oldClasses = @(Get-ChildItem -LiteralPath $resolvedBuild -Recurse -File -Filter '*.class')
foreach ($classFile in $oldClasses) {
    if (-not [IO.Path]::GetFullPath($classFile.FullName).StartsWith(($resolvedBuild + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Class file escaped build directory' }
}
foreach ($classFile in $oldClasses) { Remove-Item -LiteralPath $classFile.FullName -Force }
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
Copy-Item -LiteralPath (Join-Path $root 'resources\exam-supplies.yml') -Destination $build -Force
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
Copy-Item -LiteralPath (Join-Path $root 'resources\block-access.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\text-bubbles.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\photo-camera.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\rpg-story.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\public-archives.yml') -Destination $build -Force
# Pin the already installed official SQLite driver; the archive must also boot
# offline, so do not ask Paper's library loader to download a new dependency.
# Preserve its own namespace, native binaries, service entry and bundled notices.
$archiveDriver = Join-Path $ServerRoot 'libraries\org\xerial\sqlite-jdbc\3.46.0.0\sqlite-jdbc-3.46.0.0.jar'
if (-not (Test-Path -LiteralPath $archiveDriver) -or (Get-FileHash -LiteralPath $archiveDriver -Algorithm SHA256).Hash -ne 'E697DF15BE3F95219D80773C5F1002030E33E932ADDA186C1C86FD51DF6691A9') { throw 'Prepare the pinned official SQLite 3.46.0.0 JAR; do not substitute an unverified driver.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archiveZip = [IO.Compression.ZipFile]::OpenRead($archiveDriver)
try {
    foreach ($archiveEntry in $archiveZip.Entries) {
        if ($archiveEntry.FullName.EndsWith('/')) { continue }
        if ($archiveEntry.FullName -notmatch '^(org/sqlite/|META-INF/services/java.sql.Driver$|META-INF/maven/org.xerial/sqlite-jdbc/|META-INF/(LICENSE|NOTICE))') { continue }
        $archiveTarget = [IO.Path]::GetFullPath((Join-Path $build $archiveEntry.FullName))
        $archiveBoundary = [IO.Path]::GetFullPath($build).TrimEnd('\') + '\'
        if (-not $archiveTarget.StartsWith($archiveBoundary,[StringComparison]::OrdinalIgnoreCase)) { throw 'Driver entry escaped build directory' }
        New-Item -ItemType Directory -Path (Split-Path -Parent $archiveTarget) -Force | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($archiveEntry,$archiveTarget,$true)
    }
} finally { $archiveZip.Dispose() }
$out = Join-Path $root 'AgentFriend-0.4.48.jar'
& $jar --create --file $out -C $build .
if ($LASTEXITCODE -ne 0) { throw 'jar failed' }
Get-FileHash -LiteralPath $out -Algorithm SHA256 | Select-Object Path,Hash
