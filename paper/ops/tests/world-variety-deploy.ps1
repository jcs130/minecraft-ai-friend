param([Parameter(Mandatory=$true)][string]$FixtureRoot)
$ErrorActionPreference='Stop'
$fixture=[IO.Path]::GetFullPath($FixtureRoot)
if(-not $fixture.StartsWith('E:\MC\ops\repairs\',[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $fixture)){throw 'Fresh private repairs fixture required'}
$script:busy=$false
function Listener {return $script:busy}
function Log([string]$message) {Write-Output $message}
. (Join-Path $PSScriptRoot '../content-deploy.ps1')
$script:checks=0
function Check([bool]$ok,[string]$label){if(-not $ok){throw $label};$script:checks++;Write-Output "PASS $label"}
function Prepare([string]$id){
 $script:opsDir=Join-Path $fixture "$id/ops";$script:serverDir=Join-Path $fixture "$id/server"
 New-Item -ItemType Directory -Path "$script:serverDir/plugins",$script:opsDir -Force | Out-Null
 $old=Join-Path $script:serverDir 'plugins/worldedit-bukkit-7.3.9.jar';[IO.File]::WriteAllText($old,'original-worldedit')
 $script:plan=@{schema=1;id="variety-$id";files=@();removeJars=@(@{name='worldedit-bukkit-7.3.9.jar';sha256=(Get-FileHash -LiteralPath $old).Hash})}
 foreach($target in @('WorldVariety-0.1.0.jar','FastAsyncWorldEdit-Paper-2.16.1.jar','world/datapacks/world-expansion--more-chinese-structures.zip','world/datapacks/zz-qiandengji-world-variety.zip','plugins/OlEncounters/schematics/qd_forest_camp.schem')){
  $source=Join-Path $script:opsDir (([guid]::NewGuid().ToString())+'.fixture');[IO.File]::WriteAllText($source,"new-$target")
  $script:plan.files+=@{source=$source;target=$target;sha256=(Get-FileHash -LiteralPath $source).Hash}
 }
 $script:pending=Join-Path $script:opsDir 'content-plugins.pending.json'
}
function SavePlan {$script:plan | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $script:pending -Encoding UTF8}
Prepare 'busy';SavePlan;$script:busy=$true;$denied=$false;try{Deploy-PendingContent}catch{$denied=$true};$script:busy=$false
Check $denied 'running Paper refuses before changing files'
Check (Test-Path -LiteralPath "$script:serverDir/plugins/worldedit-bukkit-7.3.9.jar") 'old WorldEdit survives a refused release'
foreach($bad in @('Unknown-1.0.jar','world/datapacks/world-expansion--unreviewed.zip','world/datapacks/../level.dat','plugins/OlEncounters/../../secret.yml','plugins/OlEncounters/schematics/other.schem')){
 Prepare ('bad'+$script:checks);$script:plan.files[0].target=$bad;SavePlan;$denied=$false;try{Deploy-PendingContent}catch{$denied=$true}
 Check $denied "unreviewed or escaping target refused: $bad"
}
Prepare 'cas';$script:plan.removeJars[0].sha256='0'*64;SavePlan;$denied=$false;try{Deploy-PendingContent}catch{$denied=$true}
Check $denied 'changed WorldEdit preimage refuses before installing anything'
Check (-not (Test-Path -LiteralPath "$script:serverDir/plugins/WorldVariety-0.1.0.jar")) 'failed preflight makes no partial installation'
Prepare 'success';SavePlan;Deploy-PendingContent
Check (-not (Test-Path -LiteralPath "$script:serverDir/plugins/worldedit-bukkit-7.3.9.jar")) 'exact reviewed WorldEdit is removed for FAWE'
Check (Test-Path -LiteralPath "$script:serverDir/plugins/FastAsyncWorldEdit-Paper-2.16.1.jar") 'FAWE is installed beside the other reviewed plugins'
Check (Test-Path -LiteralPath "$script:serverDir/world/datapacks/zz-qiandengji-world-variety.zip") 'shared data-pack overlay is installed'
Check (Test-Path -LiteralPath "$script:serverDir/plugins/OlEncounters/schematics/qd_forest_camp.schem") 'one reviewed encounter blueprint is installed'
$journal=Get-Content -LiteralPath "$script:opsDir/repairs/variety-success/deployment-rollback/applied.json" -Raw | ConvertFrom-Json
$recovery=@($journal | Where-Object {$_.Before})[0]
Check (([IO.File]::ReadAllText($recovery.Backup)) -eq 'original-worldedit') 'rollback retains exact original WorldEdit bytes'
Check (-not (Test-Path -LiteralPath $script:pending)) 'successful release consumes its plan'
Write-Output "PASS $script:checks deployment gates; production unchanged"
