$ErrorActionPreference='Stop'
$taskSource=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../manage-server.ps1') -Raw -Encoding UTF8
$taskStart=$taskSource.IndexOf('function PlayerRoster {')
$taskEnd=$taskSource.IndexOf('function NumenBodyUuids {',$taskStart)
Invoke-Expression $taskSource.Substring($taskStart,$taskEnd-$taskStart)
$script:taskCount=2
$script:taskData='DeepFish has the following entity data: [I; 1882176510, -2041036995, -1754479012, 712116463]Yui has the following entity data: [I; 1508471748, -1579928165, -2114091398, 2103457465]'
function Rcon([string]$q){if($q -eq 'minecraft:list uuids'){return "There are $script:taskCount of a max of 40 players online: shortened..."};return $script:taskData}
$taskRoster=PlayerRoster
if($taskRoster.Count -ne 2 -or $taskRoster.Uuids['Yui'] -cne '59e973c4-a1d4-359b-81fd-867a7d6036b9' -or $taskRoster.Uuids['DeepFish'] -cne '702fbbfe-8658-3f3d-976c-c65c2a7208ef'){throw 'Exact UUID mismatch'}
$script:taskCount=3
$taskFailed=$false
try{PlayerRoster | Out-Null}catch{$taskFailed=$true}
if(-not $taskFailed){throw 'Count mismatch accepted'}
$script:taskCount=2
$script:taskData+='Yui has the following entity data: [I; 1508471748, -1579928165, -2114091398, 2103457465]'
$taskFailed=$false
try{PlayerRoster | Out-Null}catch{$taskFailed=$true}
if(-not $taskFailed){throw 'Duplicate UUID accepted'}
$script:taskCount=0
$script:taskData=''
if((PlayerRoster).Count -ne 0){throw 'Empty roster failed'}
'Maintenance roster: 4 checks passed; no production connection'
