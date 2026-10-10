param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$guidanceRepo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$guidanceOutput = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $guidanceOutput) { throw 'Choose a new empty build directory.' }
New-Item -ItemType Directory -Path $guidanceOutput | Out-Null
$guidanceArchive = Join-Path $guidanceOutput 'baseline.tar'
& git -C $guidanceRepo archive --format=tar --output=$guidanceArchive 1bb1905ba35d77b902473667e0b3ebdffc666684 -- paper/plugins/AgentFriend
if ($LASTEXITCODE -ne 0) { throw 'Production 0.4.13 source archive failed.' }
& tar -xf $guidanceArchive -C $guidanceOutput
if ($LASTEXITCODE -ne 0) { throw 'Source extraction failed.' }
Push-Location $guidanceOutput
try {
    & git apply --check (Join-Path $guidanceRepo 'paper/hotfixes/current-guidance-0.4.17.patch')
    if ($LASTEXITCODE -ne 0) { throw 'Guidance patch does not match production source.' }
    & git apply (Join-Path $guidanceRepo 'paper/hotfixes/current-guidance-0.4.17.patch')
    if ($LASTEXITCODE -ne 0) { throw 'Guidance patch failed.' }
    $guidancePlugin = Join-Path $guidanceOutput 'paper/plugins/AgentFriend'
    $guidanceUtf8 = [Text.UTF8Encoding]::new($false)
    foreach ($guidanceFile in @('build.ps1','resources/plugin.yml')) {
        $guidancePath = Join-Path $guidancePlugin $guidanceFile
        $guidanceText = [IO.File]::ReadAllText($guidancePath).Replace('0.4.13','0.4.17')
        [IO.File]::WriteAllText($guidancePath,$guidanceText,$guidanceUtf8)
    }
    & (Join-Path $guidancePlugin 'build.ps1')
    if (-not $?) { throw 'Hotfix build failed.' }
    Get-FileHash -LiteralPath (Join-Path $guidancePlugin 'AgentFriend-0.4.17.jar') -Algorithm SHA256
} finally { Pop-Location }
