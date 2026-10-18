param([Parameter(Mandatory=$true)][string]$CandidateJar,[string]$ServerRoot='E:/MC/server',[string]$JavaHome='E:/MC/jdk/jdk-21.0.12.1+1')
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'test-task-progress-guidance.ps1') -ServerRoot $ServerRoot -PluginJar $CandidateJar -JavaHome $JavaHome
if($LASTEXITCODE -ne 0){throw 'Task rules failed'}
$chainTemp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
$chainClasses=Join-Path $chainTemp ('agentfriend-local-cli-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $chainClasses | Out-Null
try{
    $chainCp=@($CandidateJar,(Join-Path $ServerRoot 'versions/1.21.1/paper-1.21.1.jar'))+@(Get-ChildItem -LiteralPath (Join-Path $ServerRoot 'libraries') -Recurse -File -Filter '*.jar' | ForEach-Object FullName)
    & (Join-Path $JavaHome 'bin/javac.exe') -proc:none -encoding UTF-8 -cp ($chainCp -join ';') -d $chainClasses (Join-Path $PSScriptRoot 'tests/org/afuhome/agentfriend/LocalTaskCliTest.java')
    if($LASTEXITCODE -ne 0){throw 'CLI test compilation failed'}
    & (Join-Path $JavaHome 'bin/java.exe') -cp ($chainClasses+';'+($chainCp -join ';')) org.afuhome.agentfriend.LocalTaskCliTest
    if($LASTEXITCODE -ne 0){throw 'CLI tests failed'}
}finally{
    $chainResolved=[IO.Path]::GetFullPath($chainClasses)
    if(-not $chainResolved.StartsWith($chainTemp,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $chainResolved) -notmatch '^agentfriend-local-cli-[a-f0-9]{32}$'){throw 'Unsafe test cleanup path'}
    Remove-Item -LiteralPath $chainResolved -Recurse -Force
}
