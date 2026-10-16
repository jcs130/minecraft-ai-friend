param(
    [Parameter(Mandatory=$true)][string]$InputJar,
    [Parameter(Mandatory=$true)][string]$OutputJar,
    [Parameter(Mandatory=$true)][string]$Libraries,
    [Parameter(Mandatory=$true)][string]$JavaHome,
    [Parameter(Mandatory=$true)][string]$BuildDirectory
)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $BuildDirectory){throw 'BuildDirectory must be fresh'}
New-Item -ItemType Directory -Path $BuildDirectory | Out-Null
$asm=@(Get-ChildItem -LiteralPath "$Libraries\org\ow2\asm" -Recurse -File -Filter '*9.7.1.jar' | Where-Object {$_.Name -match '^asm(-tree)?-9\.7\.1\.jar$'} | Select-Object -ExpandProperty FullName)
if($asm.Count -ne 2){throw 'ASM 9.7.1 core and tree are required'}
$api=@(Get-ChildItem -LiteralPath "$Libraries\io\papermc\paper\paper-api" -Recurse -File -Filter '*.jar' | Select-Object -ExpandProperty FullName)
$kyori=@(Get-ChildItem -LiteralPath "$Libraries\net\kyori" -Recurse -File -Filter '*.jar' | Select-Object -ExpandProperty FullName)
$bungee=@(Get-ChildItem -LiteralPath "$Libraries\net\md-5" -Recurse -File -Filter '*.jar' | Select-Object -ExpandProperty FullName)
$cp=(@($api)+@($kyori)+@($bungee)+@($asm)) -join ';'
& "$JavaHome\bin\javac.exe" -encoding UTF-8 -cp $cp -d $BuildDirectory "$PSScriptRoot\src\qiandengji\villagerlife\Compatibility.java" "$PSScriptRoot\src\PatchVillagerLife.java"
if($LASTEXITCODE -ne 0){throw 'Compilation failed'}
& "$JavaHome\bin\java.exe" -cp ($BuildDirectory+';'+($asm -join ';')) PatchVillagerLife $InputJar $OutputJar $BuildDirectory
if($LASTEXITCODE -ne 0){throw 'Pinned patch failed'}
Get-FileHash -LiteralPath $OutputJar -Algorithm SHA256 | Select-Object Algorithm,Hash
