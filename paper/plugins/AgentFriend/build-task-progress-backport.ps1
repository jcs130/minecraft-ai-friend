param(
    [Parameter(Mandatory=$true)][string]$BaselineJar,
    [Parameter(Mandatory=$true)][string]$OutputJar,
    [string]$ServerRoot='E:/MC/server',
    [string]$JavaHome='E:/MC/jdk/jdk-21.0.12.1+1'
)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'src/org/afuhome/agentfriend/SurveyArea.java')){throw '0.4.47.5 is pinned to commit 75696c6. Current sources require build-local-task-chains-backport.ps1 (0.4.47.6).'}
# The full source tree includes unpublished archives (0.4.48). Release only this
# reviewed patch onto the exact deployed 0.4.47.4 binary, preserving other entries.
$taskExpected='f1e3dc814fda2651b46e5ebfae5c90f0346b9b10fc3acd8968739422d338ba7c'
if((Get-FileHash -LiteralPath $BaselineJar -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskExpected){throw 'Unsupported baseline; review a new backport before building'}
if([IO.Path]::GetFullPath($BaselineJar) -eq [IO.Path]::GetFullPath($OutputJar)){throw 'Output must not replace the baseline'}
$taskLiveRoot=[IO.Path]::GetFullPath($ServerRoot).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
if([IO.Path]::GetFullPath($OutputJar).StartsWith($taskLiveRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Build outside the live server directory; deployment is a separate approved operation'}
$taskTemp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
$taskBuild=Join-Path $taskTemp ('agentfriend-progress-build-'+[guid]::NewGuid().ToString('N'))
$taskSource=Join-Path $taskBuild 'source/org/afuhome/agentfriend'
$taskClasses=Join-Path $taskBuild 'classes'
$taskNames=@('TaskProgressGuidance','TaskGuidance','CombatObjectives','CombatObjectiveEvents','TaskMarketManager','GuildManager','TaskRoutes','ExplorationGuidance','GoddessObservation','WorldLifeActions')
New-Item -ItemType Directory -Path $taskSource,$taskClasses,(Join-Path $taskBuild 'empty') -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
    foreach($taskName in $taskNames){
        $taskText=[IO.File]::ReadAllText((Join-Path $PSScriptRoot "src/org/afuhome/agentfriend/$taskName.java"))
        if($taskName -eq 'GuildManager'){
            if(([regex]::Matches($taskText,'plugin\.archives\(\)\.syncSources\(\);')).Count -ne 2){throw 'Archive hooks changed; review the backport'}
            $taskText=$taskText.Replace('plugin.archives().syncSources();','')
        }
        [IO.File]::WriteAllText((Join-Path $taskSource "$taskName.java"),$taskText,[Text.UTF8Encoding]::new($false))
    }
    $taskCp=@($BaselineJar,(Join-Path $ServerRoot 'versions/1.21.1/paper-1.21.1.jar'))+
      @(Get-ChildItem -LiteralPath (Join-Path $ServerRoot 'libraries') -Recurse -File -Filter '*.jar' | ForEach-Object FullName)+
      @(Get-ChildItem -LiteralPath (Join-Path $ServerRoot 'plugins') -File -Filter '*.jar' | ForEach-Object FullName)
    $taskArgs=@('-proc:none','-encoding','UTF-8','-source','21','-target','21','-sourcepath',(Join-Path $taskBuild 'empty'),'-cp',($taskCp -join ';'),'-d',$taskClasses)+@($taskNames | ForEach-Object {Join-Path $taskSource "$_.java"})
    $taskArgFile=Join-Path $taskBuild 'javac.args'
    [IO.File]::WriteAllLines($taskArgFile,[string[]]@($taskArgs | ForEach-Object {'"'+$_.Replace('\','/')+'"'}),[Text.UTF8Encoding]::new($false))
    & (Join-Path $JavaHome 'bin/javac.exe') ('@'+$taskArgFile)
    if($LASTEXITCODE -ne 0){throw 'Backport did not compile'}
    $taskOut=[IO.Path]::GetFullPath($OutputJar)
    New-Item -ItemType Directory -Path (Split-Path -Parent $taskOut) -Force | Out-Null
    Copy-Item -LiteralPath $BaselineJar -Destination $taskOut
    $taskZip=[IO.Compression.ZipFile]::Open($taskOut,[IO.Compression.ZipArchiveMode]::Update)
    try {
        $taskEntry=$taskZip.GetEntry('plugin.yml');$taskReader=[IO.StreamReader]::new($taskEntry.Open())
        try{$taskPlugin=$taskReader.ReadToEnd()}finally{$taskReader.Dispose()}
        if(-not $taskPlugin.Contains("version: '0.4.47.4'")){throw 'Unexpected plugin version'}
        $taskEntry.Delete();$taskWriter=[IO.StreamWriter]::new($taskZip.CreateEntry('plugin.yml').Open(),[Text.UTF8Encoding]::new($false))
        try{$taskWriter.Write($taskPlugin.Replace("version: '0.4.47.4'","version: '0.4.47.5'"))}finally{$taskWriter.Dispose()}
        foreach($taskClass in Get-ChildItem -LiteralPath $taskClasses -File -Recurse -Filter '*.class'){
            $taskName=$taskClass.FullName.Substring($taskClasses.Length+1).Replace('\','/')
            $taskEntry=$taskZip.GetEntry($taskName);if($null -ne $taskEntry){$taskEntry.Delete()}
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($taskZip,$taskClass.FullName,$taskName) | Out-Null
        }
    }finally{$taskZip.Dispose()}
    function Get-TaskEntries([string]$TaskJar){
        $taskReadZip=[IO.Compression.ZipFile]::OpenRead($TaskJar);$taskHashes=@{}
        try{foreach($taskItem in $taskReadZip.Entries){$taskStream=$taskItem.Open();$taskDigest=[Security.Cryptography.SHA256]::Create();try{$taskHashes[$taskItem.FullName]=[BitConverter]::ToString($taskDigest.ComputeHash($taskStream)).Replace('-','')}finally{$taskStream.Dispose();$taskDigest.Dispose()}}}finally{$taskReadZip.Dispose()}
        return $taskHashes
    }
    $taskBefore=Get-TaskEntries $BaselineJar;$taskAfter=Get-TaskEntries $taskOut
    $taskChanged=@($taskAfter.Keys | Where-Object {$taskBefore[$_] -ne $taskAfter[$_]} | Sort-Object)
    foreach($taskName in $taskBefore.Keys){if(-not $taskAfter.ContainsKey($taskName)){throw "Backport removed $taskName"}}
    foreach($taskName in $taskChanged){
        if($taskName -eq 'plugin.yml'){continue}
        if(-not ($taskNames | Where-Object {$taskName -match ('^org/afuhome/agentfriend/'+[regex]::Escape($_)+'(\$[^/]+)?\.class$')})){throw "Unexpected binary change: $taskName"}
    }
    @{version='0.4.47.5';sha256=(Get-FileHash -LiteralPath $taskOut -Algorithm SHA256).Hash.ToLowerInvariant();baselineSha256=$taskExpected;changedEntries=$taskChanged;unrelatedEntriesIdentical=$true;deployed=$false} | ConvertTo-Json -Depth 5
} finally {
    $taskResolved=[IO.Path]::GetFullPath($taskBuild)
    if(-not $taskResolved.StartsWith($taskTemp,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $taskResolved) -notmatch '^agentfriend-progress-build-[a-f0-9]{32}$'){throw 'Unsafe build cleanup path'}
    Remove-Item -LiteralPath $taskResolved -Recurse -Force
}
