param([string]$JavaBin = '')
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
if (-not $JavaBin) {
    if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/javac.exe'))) {
        $JavaBin = Join-Path $env:JAVA_HOME 'bin'
    } else {
        $JavaBin = Split-Path (Get-Command javac -ErrorAction Stop).Source
    }
}
$taskClasses = Join-Path $taskRoot 'build/rpg-story-tests'
New-Item -ItemType Directory -Path $taskClasses -Force | Out-Null
& (Join-Path $JavaBin 'javac.exe') -encoding UTF-8 -source 21 -target 21 -d $taskClasses `
    (Join-Path $taskRoot 'src/org/afuhome/agentfriend/RpgStoryRules.java') `
    (Join-Path $taskRoot 'tests/org/afuhome/agentfriend/RpgStoryRulesTest.java')
if ($LASTEXITCODE -ne 0) { throw 'RPG story rule compilation failed' }
& (Join-Path $JavaBin 'java.exe') -ea -cp $taskClasses org.afuhome.agentfriend.RpgStoryRulesTest
if ($LASTEXITCODE -ne 0) { throw 'RPG story rule test failed' }
