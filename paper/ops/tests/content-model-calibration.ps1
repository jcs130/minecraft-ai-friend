param([Parameter(Mandatory=$true)][string]$FixtureRoot)
$ErrorActionPreference='Stop'
$fixture=[IO.Path]::GetFullPath($FixtureRoot)
if(-not [IO.Path]::IsPathRooted($FixtureRoot) -or (Test-Path -LiteralPath $fixture)){throw 'Use a fresh absolute fixture directory'}
$opsDir=Join-Path $fixture 'ops'; $serverDir=Join-Path $fixture 'paper'
$script:fixtureYsm=@{enabled=$true;root=(Join-Path $fixture 'ysm');controlPort=26601;proxy=@{port=26602};worker=@{port=26603};workerControllerPort=26604}
$script:busy=$false
function Listener {return $false}
function Ysm-Config {return $script:fixtureYsm}
function Log([string]$message) {Write-Output $message}
function Get-NetTCPConnection {param($LocalAddress,$LocalPort,$State,$ErrorAction); if($script:busy){[pscustomobject]@{OwningProcess=1}}}
. (Join-Path $PSScriptRoot '../content-deploy.ps1')
New-Item -ItemType Directory -Path $opsDir -Force | Out-Null
$inputs=Join-Path $fixture 'inputs';New-Item -ItemType Directory -Path $inputs | Out-Null
$plan=@{schema=1;id='model-calibration-test';files=@();removeJars=@()}
$targets=@()
foreach($id in @('cormy','neko_yui')) {
 $target=Join-Path $script:fixtureYsm.root "worker/config/yes_steve_model/custom/$id/ysm.json"
 New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
 [IO.File]::WriteAllText($target,'{"width_scale":0.7,"height_scale":0.7}')
 $source=Join-Path $inputs "$id.json";[IO.File]::WriteAllText($source,'{"width_scale":1,"height_scale":1}')
 $plan.files+=@{source=$source;target="ysm-model/$id/ysm.json";sha256=(Get-FileHash -LiteralPath $source).Hash;beforeSha256=(Get-FileHash -LiteralPath $target).Hash}
 $targets+=@{path=$target;before=(Get-FileHash -LiteralPath $target).Hash;after=(Get-FileHash -LiteralPath $source).Hash}
}
$pending=Join-Path $opsDir 'content-plugins.pending.json'
$plan | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 -LiteralPath $pending
$script:busy=$true;$refused=$false
try{Deploy-PendingContent}catch{$refused=$true}
if(-not $refused -or (Get-FileHash -LiteralPath $targets[0].path).Hash -ne $targets[0].before){throw 'Running model services must refuse before writes'}
$script:busy=$false
$bad=@{schema=1;id='model-calibration-bad';files=@(@{source=$plan.files[0].source;target='ysm-model/other/ysm.json';sha256=$plan.files[0].sha256})}
$bad | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 -LiteralPath $pending
$refused=$false;try{Deploy-PendingContent}catch{$refused=$true}
if(-not $refused){throw 'Unapproved model target accepted'}
$originalHash=$plan.files[0].beforeSha256;$plan.files[0].beforeSha256=('0'*64)
$plan | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 -LiteralPath $pending
$refused=$false;try{Deploy-PendingContent}catch{$refused=$true}
if(-not $refused -or (Get-FileHash -LiteralPath $targets[0].path).Hash -ne $targets[0].before){throw 'Changed model preimage must refuse before writes'}
$plan.files[0].beforeSha256=$originalHash
$plan | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 -LiteralPath $pending
Deploy-PendingContent
foreach($row in $targets){if((Get-FileHash -LiteralPath $row.path).Hash -ne $row.after){throw 'Model bytes differ'}}
if(Test-Path -LiteralPath $pending){throw 'Plan not consumed'}
$applied=Get-Content -Raw -LiteralPath (Join-Path $opsDir 'repairs/model-calibration-test/deployment-rollback/applied.json') | ConvertFrom-Json
foreach($entry in $applied){if((Get-FileHash -LiteralPath $entry.Backup).Hash -ne $originalHash){throw 'Original recovery bytes not retained'}}
Write-Output 'PASS 8: stopped gate, model allowlist, changed preimage, both exact models, plan consumed, both recoverable preimages.'
