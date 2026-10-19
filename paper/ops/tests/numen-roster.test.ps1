$ErrorActionPreference='Stop'
$taskScript=Join-Path $PSScriptRoot '../manage-server.ps1'
$taskAst=[System.Management.Automation.Language.Parser]::ParseFile($taskScript,[ref]$null,[ref]$null)
foreach($taskName in @('PlayerRoster','NumenBodyUuids','HumanPlayers')) {
    $taskDefinition=$taskAst.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true) | Where-Object Name -eq $taskName
    Invoke-Expression $taskDefinition.Extent.Text
}
$script:taskRoster='There are 2 of a max of 40 players online: ag_CorMy (822d173a-7181-3b9b-be60-804f29b24ecc), 小灯 (11111111-2222-3333-4444-555566667777)'
$script:taskBodies='小灯 has the following entity data: [I; 286331153, 572666675, 1145328981, 1717991287]'
function Rcon([string]$text) {
    if($text -eq 'minecraft:list uuids'){return $script:taskRoster}
    if($text -eq 'minecraft:execute as @a if data entity @s NumenOwner run minecraft:data get entity @s UUID'){return $script:taskBodies}
    throw 'Unexpected maintenance command'
}
if((PlayerRoster).Uuids['小灯'] -ne '11111111-2222-3333-4444-555566667777'){throw 'Unicode roster/UUID lost'}
if(@(HumanPlayers).Count -ne 0){throw 'Verified server companion blocked maintenance'}
$script:taskBodies='Test failed'
if(@(HumanPlayers) -join ',' -ne '小灯'){throw 'Missing body evidence bypassed human gate'}
$script:taskBodies='小灯 has the following entity data: [I; -1, -1, -1, -1]'
if(@(NumenBodyUuids) -join ',' -ne 'ffffffff-ffff-ffff-ffff-ffffffffffff'){throw 'Signed UUID converted incorrectly'}
if(@(HumanPlayers) -join ',' -ne '小灯'){throw 'Different body UUID bypassed human gate'}
$script:taskBodies='incomplete [I; 286331153, 572666675'
if(@(HumanPlayers) -join ',' -ne '小灯'){throw 'Malformed body reply bypassed human gate'}
$script:taskRoster='There are 1 of a max of 40 players online: ag_Impostor (11111111-2222-3333-4444-555566667777)'
$script:taskBodies='Test failed'
if(@(HumanPlayers) -join ',' -ne 'ag_Impostor'){throw 'Agent name prefix bypassed human gate'}
$script:taskRoster='There are 2 of a max of 40 players online: LittleFish0510 (aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee), 小灯 (11111111-2222-3333-4444-555566667777)'
$script:taskBodies='小灯 has the following entity data: [I; 286331153, 572666675, 1145328981, 1717991287]'
if(@(HumanPlayers) -join ',' -ne 'LittleFish0510'){throw 'Real human was excluded with companion'}
$script:taskRoster='There are 0 of a max of 40 players online: '
if((PlayerRoster).Count -ne 0 -or @(HumanPlayers).Count -ne 0){throw 'Empty roster failed'}
$script:taskRoster='There are 2 of a max of 40 players online: ag_CorMy (822d173a-7181-3b9b-be60-804f29b24ecc)'
$taskRefused=$false
try{PlayerRoster | Out-Null}catch{$taskRefused=$true}
if(-not $taskRefused){throw 'Partial roster accepted'}
# Captured from the isolated Paper server after a real Numen summon. Keep the
# actual signed NBT integers: synthetic all-positive UUIDs miss this boundary.
$script:taskRoster='There are 2 of a max of 20 players online: ag_NuProbe20 (e200f422-95e5-4187-8ff8-d8ac32acf537), NumenOwner20 (218b8dd3-24c0-3a72-a2ed-7cf710ef3d2d)'
$script:taskBodies='ag_NuProbe20 has the following entity data: [I; -503253982, -1780137593, -1879517012, 850195767]'
if(@(HumanPlayers) -join ',' -ne 'NumenOwner20'){throw 'Native Numen body evidence did not preserve owner safety gate'}
Write-Output 'Numen maintenance roster: 11 cases passed; no live server contacted'
