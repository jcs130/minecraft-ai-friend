param([Parameter(Mandatory=$true)][string]$CandidateRoot)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../content-deploy.ps1')
$checks=0
foreach($case in @(
 @('LightAntiCheat-1.2.6-qd1.jar',$true),
 @('QiandengjiAntiCheat-0.1.0.jar',$true),
 @('plugins/LightAntiCheat/config.yml',$true),
 @('LightAntiCheat-1.2.6.jar',$false),
 @('LightAntiCheat-1.2.7.jar',$false),
 @('QiandengjiAntiCheat-0.2.0.jar',$false),
 @('plugins/LightAntiCheat/logs/current.log',$false),
 @('plugins/LightAntiCheat/../LuckPerms/config.yml',$false),
 @('plugins/lightanticheat/config.yml',$false)
)){if((Content-AgentAntiCheatTarget $case[0]) -ne $case[1]){throw 'target boundary'};$checks++}
if(Content-AgentAntiCheatJar 'plugins/LightAntiCheat/config.yml'){throw 'config accepted as removable jar'};$checks++
$inputRoot=([IO.Path]::GetFullPath($CandidateRoot)).Replace([char]92,[char]47)
if(-not $inputRoot.StartsWith('E:/MC/ops/repairs/',[StringComparison]::OrdinalIgnoreCase)){throw 'isolated repair root required'}
$fixture=Join-Path $inputRoot ('anti-install-'+[guid]::NewGuid().ToString('N'))
$serverDir=Join-Path $fixture 'server';$opsDir=Join-Path $fixture 'ops'
New-Item -ItemType Directory -Path $serverDir,$opsDir -Force | Out-Null
$script:listening=$false
function Listener{return $script:listening}
function Log([string]$text){}
function Plan($file,$remove=@()){@{schema=1;id=('anti-test-'+[guid]::NewGuid().ToString('N'));files=@($file);removeJars=@($remove)}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $opsDir 'content-plugins.pending.json') -Encoding UTF8}
function Refuse($file,$reason){Plan $file;$failed=$false;try{Deploy-PendingContent}catch{if($_ -notmatch $reason){throw};$failed=$true};if(-not $failed){throw "unsafe plan accepted: $reason"};$script:checks++}
$file=@{source=(Join-Path $inputRoot 'candidate/plugins/LightAntiCheat/config.yml');target='plugins/LightAntiCheat/config.yml'}
$file.sha256=(Get-FileHash -LiteralPath $file.source -Algorithm SHA256).Hash
$script:listening=$true;Refuse $file 'requires stopped Paper';$script:listening=$false
$bad=$file.Clone();$bad.sha256='0'*64;Refuse $bad 'source hash mismatch'
$bad=$file.Clone();$bad.target='plugins/LightAntiCheat/other.yml';Refuse $bad 'Unexpected content target'
Plan $file;Deploy-PendingContent
if((Get-FileHash -LiteralPath (Join-Path $serverDir $file.target)).Hash -ne $file.sha256){throw 'install mismatch'};$checks++
Refuse $file 'unrecorded file'
$bad=$file.Clone();$bad.beforeSha256='0'*64;Refuse $bad 'target changed'
$file.beforeSha256=$file.sha256;Plan $file;Deploy-PendingContent
if(-not(Get-ChildItem -LiteralPath (Join-Path $opsDir 'repairs') -Recurse -Filter '0.original')){throw 'rollback missing'};$checks++
foreach($name in @('LightAntiCheat-1.2.6-qd1.jar','QiandengjiAntiCheat-0.1.0.jar')){
 $jar=@{source=(Join-Path $inputRoot ('candidate/'+$name));target=$name};$jar.sha256=(Get-FileHash -LiteralPath $jar.source -Algorithm SHA256).Hash
 Plan $jar;Deploy-PendingContent
 if((Get-FileHash -LiteralPath (Join-Path $serverDir ('plugins/'+$name))).Hash -ne $jar.sha256){throw 'jar install mismatch'};$checks++
 # Real rollback goes through the same exact-name, digest and stopped gates.
 $empty=@{schema=1;id=('anti-remove-'+[guid]::NewGuid().ToString('N'));files=@();removeJars=@(@{name=$name;sha256=$jar.sha256})}
 $empty|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $opsDir 'content-plugins.pending.json') -Encoding UTF8
 Deploy-PendingContent
 if(Test-Path -LiteralPath (Join-Path $serverDir ('plugins/'+$name))){throw 'rollback did not remove exact jar'};$checks++
}
Write-Output "Anticheat installer: $checks checks passed; production untouched"
