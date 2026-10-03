$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$java = 'E:\MC\jdk\jdk-21.0.12.1+1\bin\javac.exe'
$jar = 'E:\MC\jdk\jdk-21.0.12.1+1\bin\jar.exe'
$classpath = @(
    Get-ChildItem -LiteralPath 'E:\MC\server\libraries' -Recurse -Filter '*.jar' -File | ForEach-Object { $_.FullName }
    'E:\MC\server\plugins\MagicSpells-4.0-Beta-15.jar'
    'E:\MC\server\plugins\AuraSkills-2.4.0.jar'
    'E:\MC\server\plugins\worldguard-bukkit-7.0.10-dist.jar'
    'E:\MC\server\plugins\worldedit-bukkit-7.3.9.jar'
    'E:\MC\server\plugins\EssentialsX-2.22.0.jar'
    'E:\MC\server\versions\1.20.6\paper-1.20.6.jar'
) -join ';'
$build = Join-Path $root 'build-0.3.75'
New-Item -ItemType Directory -Path $build -Force | Out-Null
& $java -encoding UTF-8 -source 21 -target 21 -cp $classpath -d $build (Get-ChildItem -LiteralPath (Join-Path $root 'src\org\afuhome\agentfriend') -Filter '*.java' -File | ForEach-Object { $_.FullName })
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }
Copy-Item -LiteralPath (Join-Path $root 'resources\plugin.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\config.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\trial-road.tsv') -Destination $build -Force
$out = Join-Path $root 'AgentFriend-0.3.75.jar'
& $jar --create --file $out -C $build .
if ($LASTEXITCODE -ne 0) { throw 'jar failed' }
Get-FileHash -LiteralPath $out -Algorithm SHA256 | Select-Object Path,Hash
