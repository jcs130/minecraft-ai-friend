param([string]$ServerRoot='E:/MC/server')
$ErrorActionPreference='Stop'
$routeJava='E:/MC/jdk/jdk-21.0.12.1+1/bin'
$routeBuild=Join-Path $PSScriptRoot 'build-0.4.42-route-tests'
New-Item -ItemType Directory -Path $routeBuild -Force | Out-Null
$routeLibraries=(Get-ChildItem -LiteralPath (Join-Path $ServerRoot 'libraries') -Recurse -File -Filter '*.jar' | ForEach-Object {$_.FullName}) -join ';'
$routeTests=@('CombatObjectivesTest','TaskRouteCatalogTest')
$routeSource=@('CombatObjectives','TaskRouteCatalog') | ForEach-Object {Join-Path $PSScriptRoot "src/org/afuhome/agentfriend/$_.java"}
$routeSource+=@($routeTests | ForEach-Object {Join-Path $PSScriptRoot "tests/org/afuhome/agentfriend/$_.java"})
& (Join-Path $routeJava 'javac.exe') -proc:none -encoding UTF-8 -cp $routeLibraries -d $routeBuild $routeSource
if($LASTEXITCODE -ne 0){throw 'Route rules test compilation failed'}
foreach($routeTest in $routeTests) {
    & (Join-Path $routeJava 'java.exe') -cp ($routeBuild+';'+$routeLibraries) "org.afuhome.agentfriend.$routeTest"
    if($LASTEXITCODE -ne 0){throw "$routeTest failed"}
}
