param(
    [string]$ServerRoot = 'E:\MC\server',
    [ValidateSet('1.20.6', '1.21.1')][string]$MinecraftVersion = '1.21.1'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$jdk = 'E:\MC\jdk\jdk-21.0.12.1+1\bin'
$java = Join-Path $jdk 'javac.exe'
$jar = Join-Path $jdk 'jar.exe'
$protocol = Join-Path $ServerRoot 'plugins\ProtocolLib-5.3.0.jar'
$paper = Join-Path $ServerRoot "versions\$MinecraftVersion\paper-$MinecraftVersion.jar"
if (-not (Test-Path -LiteralPath $paper)) { throw "Prepare Paper $MinecraftVersion first, or pass -ServerRoot pointing to the isolated candidate." }
$spectator = @(Get-ChildItem -LiteralPath (Join-Path $ServerRoot 'plugins') -Filter 'spectatorplus-paper-*.jar' -File)
if ($spectator.Count -ne 1) { throw 'Exactly one enabled SpectatorPlus JAR is required for a reproducible build.' }
$libraries = Get-ChildItem -LiteralPath (Join-Path $ServerRoot 'libraries') -Recurse -Filter '*.jar' -File |
    ForEach-Object { $_.FullName }
$classpath = (@($paper, $protocol, (Join-Path $ServerRoot 'plugins\AuraSkills-2.4.0.jar'),
    $spectator[0].FullName) + $libraries) -join ';'
$build = Join-Path $root "build-0.1.16-mc-$MinecraftVersion"
New-Item -ItemType Directory -Path $build -Force | Out-Null
$compileArguments = @('-proc:none', '-encoding', 'UTF-8', '-source', '21', '-target', '21', '-cp', $classpath, '-d', $build,
    (Get-Item -LiteralPath (Join-Path $root '..\shared\src\org\afuhome\eye\EyePairs.java')).FullName) +
    @(Get-ChildItem -LiteralPath (Join-Path $root 'src\org\afuhome\cortieye') -Filter '*.java' -File | ForEach-Object { $_.FullName })
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
$out = Join-Path $root 'CortiEyeMirror-0.1.16.jar'
& $jar --create --file $out -C $build .
if ($LASTEXITCODE -ne 0) { throw 'jar failed' }
Get-FileHash -LiteralPath $out -Algorithm SHA256 | Select-Object Path,Hash
