$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../content-deploy.ps1')
$taskCases=@(
 @('VortexRPG-1.2.2-alpha-qd27-zh.jar',$true),@('QiandengjiRpg-0.2.0.jar',$true),@('Vault-1.7.3.jar',$true),
 @('VortexRPG-1.2.2-alpha-qd29.jar',$true),@('QiandengjiRpg-0.2.4.jar',$true),
 @('VortexRPG-1.2.2-alpha-qd30.jar',$true),@('QiandengjiRpg-0.2.12.jar',$true),
 @('VortexRPG-1.2.2-alpha-qd31.jar',$false),@('QiandengjiRpg-0.2.13.jar',$false),
 @('QiandengjiRpg-0.2.6.jar',$true),@('QiandengjiRpg-0.2.7.jar',$false),
 @('plugins/VortexRPG/quests.yml',$true),@('plugins/VortexRPG/talents.yml',$true),
 @('plugins/QiandengjiRpg/config.yml',$true),@('plugins/AuraSkills/stats.yml',$true),
 @('plugins/VortexRPG/questdata/test.json',$false),@('plugins/VortexRPG/playerdata/test.json',$false),
 @('plugins/VortexRPG/talentdata/test.json',$false),@('plugins/AuraSkills/users.yml',$false),
 @('plugins/AuraSkills/mysql.yml',$false),@('plugins/QiandengjiRpg/../config.yml',$false),
 @('VortexRPG-1.2.2-alpha.jar',$false),@('Vault-1.7.4.jar',$false),@('vortexrpg-1.2.2-alpha-qd27-zh.jar',$false)
)
foreach($taskCase in $taskCases){if((Content-NativeRpgTarget $taskCase[0]) -ne $taskCase[1]){throw ('Unexpected native RPG target: '+$taskCase[0])}}
Write-Output ('Native RPG deployment boundary: '+$taskCases.Count+' checks passed; no files installed')
