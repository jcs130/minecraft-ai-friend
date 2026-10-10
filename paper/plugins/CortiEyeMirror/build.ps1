$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$jdk = 'E:\MC\jdk\jdk-21.0.12.1+1\bin'
$java = Join-Path $jdk 'javac.exe'
$jar = Join-Path $jdk 'jar.exe'
$protocol = 'E:\MC\server\plugins\ProtocolLib-5.3.0.jar'
$libraries = Get-ChildItem -LiteralPath 'E:\MC\server\libraries' -Recurse -Filter '*.jar' -File |
    ForEach-Object { $_.FullName }
$classpath = (@('E:\MC\server\versions\1.20.6\paper-1.20.6.jar', $protocol, 'E:\MC\server\plugins\AuraSkills-2.4.0.jar',
    'E:\MC\server\plugins\spectatorplus-paper-1.2.0.jar') + $libraries) -join ';'
$build = Join-Path $root 'build'
New-Item -ItemType Directory -Path $build -Force | Out-Null
& $java -proc:none -encoding UTF-8 -source 21 -target 21 -cp $classpath -d $build `
    (Get-Item -LiteralPath (Join-Path $root '..\shared\src\org\afuhome\eye\EyePairs.java')).FullName `
    (Get-ChildItem -LiteralPath (Join-Path $root 'src\org\afuhome\cortieye') -Filter '*.java' -File |
        ForEach-Object { $_.FullName })
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }
Copy-Item -LiteralPath (Join-Path $root 'resources\plugin.yml') -Destination $build -Force
Copy-Item -LiteralPath (Join-Path $root 'resources\config.yml') -Destination $build -Force
$out = Join-Path $root 'CortiEyeMirror-0.1.11.jar'
& $jar --create --file $out -C $build .
if ($LASTEXITCODE -ne 0) { throw 'jar failed' }
Get-FileHash -LiteralPath $out -Algorithm SHA256 | Select-Object Path,Hash
