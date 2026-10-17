param([string]$ServerRoot='E:\MC\server',[string]$JavaHome='E:\MC\jdk\jdk-21.0.12.1+1')
$ErrorActionPreference='Stop'
$questPluginRoot=Split-Path -Parent $MyInvocation.MyCommand.Path
$questGsonRoot=Join-Path $ServerRoot 'libraries\com\google\code\gson\gson'
$questGson=@(Get-ChildItem -LiteralPath $questGsonRoot -Recurse -Filter 'gson-*.jar' -File | Sort-Object FullName | Select-Object -Last 1)
if($questGson.Count -ne 1){throw 'Prepare the server Gson dependency first.'}
$questTempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
$questOutput=[IO.Path]::GetFullPath((Join-Path $questTempRoot ('agentfriend-quest-tests-'+[guid]::NewGuid().ToString('N'))))
New-Item -ItemType Directory -Path $questOutput | Out-Null
try {
    & (Join-Path $JavaHome 'bin\javac.exe') -encoding UTF-8 -proc:none -cp $questGson[0].FullName -d $questOutput `
        (Join-Path $questPluginRoot 'src\org\afuhome\agentfriend\QuestGuidance.java') `
        (Join-Path $questPluginRoot 'tests\org\afuhome\agentfriend\QuestGuidanceTest.java') `
        (Join-Path $questPluginRoot 'src\org\afuhome\agentfriend\SurveyMovement.java') `
        (Join-Path $questPluginRoot 'tests\org\afuhome\agentfriend\SurveyMovementTest.java')
    if($LASTEXITCODE -ne 0){throw 'Quest guidance test compilation failed.'}
    & (Join-Path $JavaHome 'bin\java.exe') -cp ($questOutput+';'+$questGson[0].FullName) org.afuhome.agentfriend.QuestGuidanceTest
    if($LASTEXITCODE -ne 0){throw 'Quest guidance rule tests failed.'}
    & (Join-Path $JavaHome 'bin\java.exe') -cp ($questOutput+';'+$questGson[0].FullName) org.afuhome.agentfriend.SurveyMovementTest
    if($LASTEXITCODE -ne 0){throw 'Survey movement credit tests failed.'}
} finally {
    $questResolved=[IO.Path]::GetFullPath($questOutput)
    if(-not $questResolved.StartsWith($questTempRoot,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $questResolved) -notmatch '^agentfriend-quest-tests-[a-f0-9]{32}$'){throw 'Refusing unsafe test cleanup path.'}
    Remove-Item -LiteralPath $questResolved -Recurse -Force
}
