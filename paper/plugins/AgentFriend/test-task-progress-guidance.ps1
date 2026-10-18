param([string]$ServerRoot='E:/MC/server',[string]$PluginJar='E:/MC/server/plugins/AgentFriend-0.4.47.4.jar',[string]$JavaHome='E:/MC/jdk/jdk-21.0.12.1+1')
$ErrorActionPreference='Stop'
$taskTemp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
$taskOutput=Join-Path $taskTemp ('agentfriend-task-guidance-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskOutput | Out-Null
try {
    $taskCp=@($PluginJar,(Join-Path $ServerRoot 'versions/1.21.1/paper-1.21.1.jar'))+@(Get-ChildItem -LiteralPath (Join-Path $ServerRoot 'libraries') -Recurse -File -Filter '*.jar' | ForEach-Object FullName)
    $taskCp+=@(Get-ChildItem -LiteralPath (Join-Path $ServerRoot 'plugins') -File -Filter '*.jar' | ForEach-Object FullName)
    $taskSources=@('TaskGuidance','TaskProgressGuidance','CombatObjectives','ExplorationGuidance','ExplorationObjectives','SurveyArea','ExplorationPauseStore') | ForEach-Object {Join-Path $PSScriptRoot "src/org/afuhome/agentfriend/$_.java"}
    $taskTests=@('TaskProgressGuidanceTest','CombatObjectivesTest','ExplorationGuidanceTest','LocalTaskChainsTest')
    $taskSources+=@($taskTests | ForEach-Object {Join-Path $PSScriptRoot "tests/org/afuhome/agentfriend/$_.java"})
    & (Join-Path $JavaHome 'bin/javac.exe') -encoding UTF-8 -proc:none -cp ($taskCp -join ';') -d $taskOutput $taskSources
    if($LASTEXITCODE -ne 0){throw 'Task guidance tests did not compile'}
    foreach($taskTest in $taskTests){
        $taskInput=if($taskTest -eq 'ExplorationGuidanceTest'){Join-Path $PSScriptRoot '../../ops/exploration-landmarks.json'}elseif($taskTest -eq 'LocalTaskChainsTest'){Join-Path $PSScriptRoot 'resources'}else{Join-Path $ServerRoot 'plugins/AgentFriend'}
        & (Join-Path $JavaHome 'bin/java.exe') -cp ($taskOutput+';'+($taskCp -join ';')) "org.afuhome.agentfriend.$taskTest" $taskInput
        if($LASTEXITCODE -ne 0){throw "$taskTest failed"}
    }
} finally {
    $taskResolved=[IO.Path]::GetFullPath($taskOutput)
    if(-not $taskResolved.StartsWith($taskTemp,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $taskResolved) -notmatch '^agentfriend-task-guidance-[a-f0-9]{32}$'){throw 'Unsafe test cleanup path'}
    Remove-Item -LiteralPath $taskResolved -Recurse -Force
}
