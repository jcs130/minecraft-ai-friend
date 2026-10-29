param([Parameter(Mandatory=$true)][string]$CandidateRoot)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../content-deploy.ps1')
$checks=0
foreach($case in @(
    @('voicechat-bukkit-2.6.27.jar',$true),@('QiandengVoice-0.1.0.jar',$true),
    @('plugins/QiandengVoice/config.yml',$true),@('plugins/QiandengVoice/bridge.token',$true),
    @('plugins/voicechat/voicechat-server.properties',$true),
    @('voicechat-velocity-2.6.26.jar',$false),@('voicechat-fabric-1.21.1-2.6.27.jar',$false),
    @('plugins/QiandengVoice/profiles.yml',$false),@('plugins/QiandengVoice/receipts/a.jsonl',$false),
    @('plugins/QiandengVoice/../LuckPerms/config.yml',$false),@('QiandengVoice-0.1.1.jar',$false)
)) { if ((Content-ProximityVoiceTarget $case[0]) -ne $case[1]) { throw 'voice target boundary' }; $checks++ }
$root=[IO.Path]::GetFullPath($CandidateRoot)
if(-not $root.StartsWith('E:\MC\ops\repairs\',[StringComparison]::OrdinalIgnoreCase)){throw 'isolated fixture root required'}
$fixture=Join-Path $root ('voice-install-'+[guid]::NewGuid().ToString('N'))
$serverDir=Join-Path $fixture 'server';$opsDir=Join-Path $fixture 'ops';$cold=Join-Path $fixture 'cold';$mirror=Join-Path $fixture 'mirror'
New-Item -ItemType Directory -Path $serverDir,$opsDir,$cold,$mirror -Force | Out-Null
$script:listening=$false
function Listener{return $script:listening}
function Log([string]$text){}
function Plan($file){@{schema=1;id=('voice-test-'+[guid]::NewGuid().ToString('N'));files=@($file);removeJars=@()}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $opsDir 'content-plugins.pending.json') -Encoding UTF8}
function Refuse($file,$reason){Plan $file;$failed=$false;try{Deploy-PendingContent $cold $mirror}catch{if($_ -notmatch $reason){throw};$failed=$true};if(-not $failed){throw 'Unsafe voice install accepted'};$script:checks++}
$source=Join-Path $fixture 'voice.jar';[IO.File]::WriteAllBytes($source,[byte[]]@(1,2,3))
$file=@{source=$source;target='QiandengVoice-0.1.0.jar';sha256=(Get-FileHash -LiteralPath $source).Hash}
Refuse $file 'both complete cold backups'
New-Item -ItemType File -Path (Join-Path $cold '.complete'),(Join-Path $mirror '.complete') | Out-Null
$script:listening=$true;Refuse $file 'requires stopped Paper';$script:listening=$false
$bad=$file.Clone();$bad.sha256='0'*64;Refuse $bad 'source hash mismatch'
$bad=$file.Clone();$bad.target='voicechat-velocity-2.6.26.jar';Refuse $bad 'Unexpected plugin JAR'
Plan $file;Deploy-PendingContent $cold $mirror
if((Get-FileHash -LiteralPath (Join-Path $serverDir 'plugins/QiandengVoice-0.1.0.jar')).Hash -ne $file.sha256){throw 'Voice install mismatch'};$checks++
Refuse $file 'unrecorded file'
$bad=$file.Clone();$bad.beforeSha256='0'*64;Refuse $bad 'target changed'
$file.beforeSha256=$file.sha256;Plan $file;Deploy-PendingContent $cold $mirror
if(-not (Get-ChildItem -LiteralPath (Join-Path $opsDir 'repairs') -Recurse -Filter '0.original')){throw 'Voice before-image missing'};$checks++
Write-Output "PASS $checks voice deployment boundary checks"
