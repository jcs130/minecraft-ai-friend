$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../content-deploy.ps1')
$blinkCases=@(
 @('plugins/MagicSpells/QiandengjiSmartBlink-0.1.0.jar',$true),
 @('plugins/MagicSpells/spells-regular.yml',$true),
 @('plugins/MagicSpells/QiandengjiSmartBlink-0.1.1.jar',$false),
 @('plugins/MagicSpells/other.jar',$false),
 @('plugins/MagicSpells/../spells-regular.yml',$false),
 @('plugins/MagicSpells/playerdata/test.yml',$false),
 @('plugins/MagicSpells/mana.yml',$false),
 @('plugins/other/spells-regular.yml',$false),
 @('plugins/magicspells/spells-regular.yml',$false),
 @('QiandengjiSmartBlink-0.1.0.jar',$false)
)
foreach($blinkCase in $blinkCases){if((Content-SmartBlinkTarget $blinkCase[0]) -ne $blinkCase[1]){throw ('Unexpected smart blink target: '+$blinkCase[0])}}
Write-Output ('Smart blink deployment boundary: '+$blinkCases.Count+' checks passed; no files installed')
