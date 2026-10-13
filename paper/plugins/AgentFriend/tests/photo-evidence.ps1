$ErrorActionPreference='Stop'
$photoRoot=Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$photoBuild=Join-Path $photoRoot 'build-0.4.37-tests'
New-Item -ItemType Directory -Path $photoBuild -Force | Out-Null
$photoClasspath=@((Join-Path $photoRoot 'build-0.4.37')) + @(Get-ChildItem -LiteralPath 'E:/MC/server/libraries' -Recurse -File -Filter '*.jar' | ForEach-Object FullName)
$photoClasspath=$photoClasspath -join ';'
& 'E:/MC/jdk/jdk-21.0.12.1+1/bin/javac.exe' -proc:none -encoding UTF-8 -cp $photoClasspath -d $photoBuild (Join-Path $photoRoot 'tests/org/afuhome/agentfriend/PhotoEvidenceTest.java') (Join-Path $photoRoot 'tests/org/afuhome/agentfriend/SkillTrajectoryTest.java') (Join-Path $photoRoot 'tests/org/afuhome/agentfriend/BiomeBorderTest.java')
if($LASTEXITCODE -ne 0){throw 'Test compilation failed'}
foreach($photoTest in @('PhotoEvidenceTest','SkillTrajectoryTest','BiomeBorderTest')) {
 & 'E:/MC/jdk/jdk-21.0.12.1+1/bin/java.exe' -cp ($photoBuild+';'+$photoClasspath) ('org.afuhome.agentfriend.'+$photoTest) (Join-Path $photoRoot 'resources')
 if($LASTEXITCODE -ne 0){throw "Failed $photoTest"}
}
