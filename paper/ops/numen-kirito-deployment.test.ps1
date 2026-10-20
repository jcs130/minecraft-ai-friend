$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'content-deploy.ps1')
$script:testBlocked=$false
function Ysm-Config { return @{enabled=$true;root='E:\MC\staging\numen-kirito-target-tests';controlPort=29990;workerControllerPort=29991;proxy=@{port=29992};worker=@{port=29993}} }
function Get-NetTCPConnection { param($LocalAddress,$LocalPort,$State,$ErrorAction) if($script:testBlocked){return @{LocalPort=$LocalPort}} }
$good=@('ysm-appearance/models.json','ysm-model/qiandengji_kirito/ysm.json','ysm-model/qiandengji_kirito/models/main.json','ysm-model/qiandengji_kirito/models/arm.json','ysm-model/qiandengji_kirito/animations/main.animation.json','ysm-model/qiandengji_kirito/animations/tac.animation.json','ysm-model/qiandengji_kirito/textures/skin.png','ysm-model/qiandengji_kirito/avatar/dm.png','ysm-model/qiandengji_kirito/avatar/gsl.png','ysm-model/qiandengji_kirito/avatar/tzz.png','ysm-model/qiandengji_kirito/lang/zh_cn.json','ysm-model/qiandengji_kirito/lang/en_us.json','ysm-model/qiandengji_kirito/CREDITS.txt','ysm-model/qiandengji_kirito/.qiandengji-generated.json')
foreach($relative in $good){$target=Content-KiritoAppearanceTarget $relative;if(-not $target.StartsWith('E:\MC\staging\numen-kirito-target-tests\')){throw 'Escaped reviewed root'}}
$bad=@('ysm-model/cormy/ysm.json','ysm-model/qiandengji_kirito/../server.properties','ysm-model/qiandengji_kirito/auth/ysm.key','ysm-model/qiandengji_kirito/textures/other.png','ysm-appearance/../user-data.db','ysm-model/qiandengji_kirito/Models/main.json')
foreach($relative in $bad){$rejected=$false;try{Content-KiritoAppearanceTarget $relative | Out-Null}catch{$rejected=$true};if(-not $rejected){throw "Unexpected target allowed: $relative"}}
$script:testBlocked=$true
$rejected=$false;try{Content-KiritoAppearanceTarget $good[0] | Out-Null}catch{$rejected=$true};if(-not $rejected){throw 'Running service gate bypassed'}
'PASS 21 deployment target and stopped-service checks'
