param([Parameter(Mandatory=$true)][string]$CandidateRoot)
$ErrorActionPreference='Stop'
$candidate=[IO.Path]::GetFullPath($CandidateRoot)
if(-not $candidate.StartsWith('E:\MC\ops\repairs\',[StringComparison]::OrdinalIgnoreCase)){throw 'Use a private frozen repairs candidate'}
. (Join-Path $PSScriptRoot '../content-deploy.ps1')
function Listener {return $false}
function Log([string]$message){}
$targetRoot=Join-Path ([IO.Path]::GetTempPath()) ('qd-blink-'+[guid]::NewGuid().ToString('N'))
if([IO.Path]::GetPathRoot($targetRoot)-cne 'C:\'){throw 'Requires a C: target and E: sources'}
$template=Get-Content -LiteralPath (Join-Path $candidate 'frozen-plan.json') -Raw -Encoding UTF8|ConvertFrom-Json
$checks=0
foreach($phase in @('rollback','success','changed-preimage','running')){
    $serverDir=Join-Path $targetRoot ($phase+'/server');$opsDir=Join-Path $targetRoot ($phase+'/ops')
    New-Item -ItemType Directory -Path (Join-Path $serverDir 'plugins/MagicSpells'),$opsDir -Force|Out-Null
    $oldJar=Join-Path $serverDir 'plugins/AgentFriend-0.4.47.37-rpg.jar'
    Copy-Item -LiteralPath (Join-Path $candidate 'before/AgentFriend-0.4.47.37-rpg.jar') -Destination $oldJar
    $config=Join-Path $serverDir 'plugins/MagicSpells/spells-regular.yml'
    Copy-Item -LiteralPath (Join-Path $candidate 'before/spells-regular.yml') -Destination $config
    Copy-Item -LiteralPath (Join-Path $candidate 'before/content-deploy.ps1') -Destination (Join-Path $opsDir 'content-deploy.ps1')
    $before=@{}
    foreach($file in Get-ChildItem -LiteralPath (Split-Path -Parent $serverDir) -File -Recurse){$before[$file.FullName]=(Get-FileHash -LiteralPath $file.FullName).Hash}
    $template.id='smart-blink-test-'+$phase
    $pending=Join-Path $opsDir 'content-plugins.pending.json'
    $template|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $pending -Encoding UTF8
    if($phase-eq 'changed-preimage'){Add-Content -LiteralPath $config -Value '# concurrent change';$before[$config]=(Get-FileHash -LiteralPath $config).Hash}
    if($phase-eq 'running'){function Listener {return $true}}
    if($phase-eq 'rollback'){
        function Remove-Item([string]$LiteralPath,[switch]$Force){
            if([IO.Path]::GetFileName($LiteralPath)-ceq 'AgentFriend-0.4.47.37-rpg.jar'){throw 'Controlled old-build removal failure'}
            Microsoft.PowerShell.Management\Remove-Item -LiteralPath $LiteralPath -Force:$Force
        }
    }
    $failure=$null
    try {Deploy-PendingContent} catch {$failure=[string]$_} finally {
        if($phase-eq 'rollback'){Remove-Item Function:Remove-Item}
        function Listener {return $false}
    }
    if($phase-eq 'success'){
        if($failure){throw $failure}
        foreach($row in $template.files){
            $target=if($row.target-eq 'ops/content-deploy.ps1'){Join-Path $opsDir 'content-deploy.ps1'}elseif($row.target.EndsWith('.jar')-and -not $row.target.Contains('/')){Join-Path (Join-Path $serverDir 'plugins') $row.target}else{Join-Path $serverDir $row.target}
            if((Get-FileHash -LiteralPath $target).Hash-ne $row.sha256){throw 'Installed bytes differ'};$checks++
        }
        if(Test-Path -LiteralPath $oldJar){throw 'Previous build remains'};$checks++
        if(Test-Path -LiteralPath $pending){throw 'Plan was not consumed'};$checks++
        $receipt=Join-Path $opsDir ('repairs/'+$template.id+'/deployment-rollback/applied.json')
        $journal=@(Get-Content -LiteralPath $receipt -Raw -Encoding UTF8|ConvertFrom-Json)
        if($journal.Count-ne 5 -or @($journal|Where-Object {-not $_.Target -or -not $_.Backup}).Count){throw 'Incomplete five-file recovery journal'};$checks++
        continue
    }
    $expected=switch($phase){'rollback'{'Controlled old-build removal failure'} 'changed-preimage'{'Content target changed'} 'running'{'Content deployment requires stopped Paper'}}
    if(-not $failure -or $failure-notmatch [regex]::Escape($expected)){throw "Expected refusal missing for $phase : $failure"};$checks++
    foreach($file in $before.Keys){if((Get-FileHash -LiteralPath $file).Hash-cne $before[$file]){throw "Preimage lost: $phase"};$checks++}
    foreach($target in @((Join-Path $serverDir 'plugins/AgentFriend-0.4.47.38-rpg.jar'),(Join-Path $serverDir 'plugins/MagicSpells/QiandengjiSmartBlink-0.1.0.jar'))){if(Test-Path -LiteralPath $target){throw "Unexpected new JAR after $phase"};$checks++}
    if(-not(Test-Path -LiteralPath $pending)){throw 'Rejected plan was consumed'};$checks++
}
Write-Output ('Smart blink: '+$checks+' real E:/C: install, rollback and refusal checks passed; fixture '+$targetRoot)
