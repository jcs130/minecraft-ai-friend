[CmdletBinding()]
param(
    [string]$AuraJar = 'E:\MC\server\plugins\AuraSkills-2.4.0.jar',
    [string]$Jdk = 'E:\MC\jdk\jdk-21.0.12.1+1',
    [string]$OutputDirectory = 'E:\MC\ops\repairs\performance-20261004\patch-build'
)
$ErrorActionPreference = 'Stop'
$sourceRoot = $PSScriptRoot
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
if ($outputRoot.StartsWith($sourceRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Build outside the Git source directory' }
$jarHash = (Get-FileHash -LiteralPath $AuraJar -Algorithm SHA256).Hash.ToLowerInvariant()
$pinLines = Get-Content -LiteralPath (Join-Path $sourceRoot 'pin.properties')
$pinnedJar = ($pinLines | Where-Object { $_ -like 'aura.jar.sha256=*' }).Split('=', 2)[1]
if ($jarHash -ne $pinnedJar) { throw "AuraSkills JAR SHA256 mismatch: $jarHash" }
$java = Join-Path $Jdk 'bin\java.exe'
$javac = Join-Path $Jdk 'bin\javac.exe'
$jar = Join-Path $Jdk 'bin\jar.exe'
if (-not (Test-Path -LiteralPath $javac)) { throw 'JDK compiler missing' }
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$buildRoot = Join-Path $outputRoot 'classes'
$patchRoot = Join-Path $outputRoot 'patched'
$fixtureRoot = Join-Path $outputRoot 'fixture'
$launcherRoot = Join-Path $outputRoot 'launcher'
foreach ($directory in @($buildRoot, $patchRoot, $fixtureRoot, $launcherRoot, (Join-Path $buildRoot 'bytes'))) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($AuraJar)
try {
    $entry = $archive.GetEntry('dev/aurelium/auraskills/common/message/LocalizedKey.class')
    if ($null -eq $entry) { throw 'LocalizedKey missing' }
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $buildRoot 'bytes\original.class'), $true)
} finally { $archive.Dispose() }
$originalHash = (Get-FileHash -LiteralPath (Join-Path $buildRoot 'bytes\original.class') -Algorithm SHA256).Hash.ToLowerInvariant()
$pinnedOriginal = ($pinLines | Where-Object { $_ -like 'original.class.sha256=*' }).Split('=', 2)[1]
if ($originalHash -ne $pinnedOriginal) { throw 'Original class SHA256 mismatch' }
$agentSources = @(Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'src') -Filter '*.java' -Recurse | ForEach-Object FullName)
& $javac --release 21 -d $buildRoot @agentSources
if ($LASTEXITCODE -ne 0) { throw 'Agent compilation failed' }
& $javac --release 21 -cp $AuraJar -d $patchRoot (Join-Path $sourceRoot 'patch\LocalizedKey.java')
if ($LASTEXITCODE -ne 0) { throw 'Patch compilation failed' }
$patchedClass = Join-Path $patchRoot 'dev\aurelium\auraskills\common\message\LocalizedKey.class'
Copy-Item -LiteralPath $patchedClass -Destination (Join-Path $buildRoot 'bytes\patched.class') -Force
$shape = & $java -cp $buildRoot dev.qiandengji.auracache.ClassShape (Join-Path $buildRoot 'bytes\original.class') $patchedClass
if ($LASTEXITCODE -ne 0) { throw 'Class shape check failed' }
$shape | Set-Content -LiteralPath (Join-Path $outputRoot 'shape.txt') -Encoding utf8
$patchedHash = (Get-FileHash -LiteralPath $patchedClass -Algorithm SHA256).Hash.ToLowerInvariant()
($pinLines + "patched.class.sha256=$patchedHash") | Set-Content -LiteralPath (Join-Path $buildRoot 'pin.properties') -Encoding ascii
$manifest = Join-Path $outputRoot 'MANIFEST.MF'
@('Manifest-Version: 1.0', 'Main-Class: dev.qiandengji.auracache.AttachCli', 'Agent-Class: dev.qiandengji.auracache.CachePatchAgent', 'Premain-Class: dev.qiandengji.auracache.CachePatchAgent', 'Can-Redefine-Classes: true', '') | Set-Content -LiteralPath $manifest -Encoding ascii
$outputJar = Join-Path $outputRoot 'auraskills-cache-patch.jar'
& $jar --create --file $outputJar --manifest $manifest -C $buildRoot .
if ($LASTEXITCODE -ne 0) { throw 'JAR creation failed' }
$fixtureSources = @(Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'test\fixture') -Filter '*.java' -Recurse | ForEach-Object FullName)
& $javac --release 21 -cp $AuraJar -d $fixtureRoot @fixtureSources
if ($LASTEXITCODE -ne 0) { throw 'Fixture compilation failed' }
& $javac --release 21 -d $launcherRoot (Join-Path $sourceRoot 'test\launcher\FixtureLauncher.java')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed' }
[ordered]@{ version = '2.4.0'; auraJarSha256 = $jarHash; originalClassSha256 = $originalHash; patchedClassSha256 = $patchedHash; patchJarSha256 = (Get-FileHash -LiteralPath $outputJar -Algorithm SHA256).Hash.ToLowerInvariant(); outputJar = $outputJar; shapeIdentical = $true } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputRoot 'build.json') -Encoding utf8
Get-Content -LiteralPath (Join-Path $outputRoot 'build.json')
