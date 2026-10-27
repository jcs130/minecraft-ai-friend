param([Parameter(Mandatory=$true)][string]$OutputRoot)
$ErrorActionPreference='Stop'
if(-not ([IO.Path]::GetFullPath($OutputRoot).Replace([char]92,[char]47).StartsWith('E:/MC/ops/repairs/'))){throw 'isolated repair root required'}
. (Join-Path $PSScriptRoot '../agent-client-identity.ps1')
$out=Join-Path $OutputRoot ('identity-test-'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $out | Out-Null
$registry=Join-Path $out 'maintenance-identities.private.json';$checks=0
function Check([bool]$value,[string]$message){if(-not $value){throw $message};$script:checks++}
Check (@(Maintenance-OwnerAgentUuids $registry).Count -eq 0) 'missing registry must not grant exemptions'
$id1='11111111-1111-4111-8111-111111111111';$id2='22222222-2222-4222-8222-222222222222';$id3='33333333-3333-4333-8333-333333333333'
$account=@{uuid=$id1;kind='agent';source='owner_confirmation';reconnectAllowed=$true}
function SaveRegistry($accounts){@{schema=1;accounts=@($accounts)}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $registry -Encoding UTF8}
SaveRegistry @($account)
Check (@(Maintenance-OwnerAgentUuids $registry) -contains $id1) 'confirmed UUID recognized'
$account.reconnectAllowed=$false;SaveRegistry @($account)
Check (@(Maintenance-OwnerAgentUuids $registry).Count -eq 0) 'reconnect opt out honored'
$account.reconnectAllowed=$true;$account.source='cli_frequency';SaveRegistry @($account)
$rejected=$false;try{Maintenance-OwnerAgentUuids $registry}catch{$rejected=$true};Check $rejected 'behavior is not authoritative identity'
$account.source='owner_confirmation';SaveRegistry @($account,$account)
$rejected=$false;try{Maintenance-OwnerAgentUuids $registry}catch{$rejected=$true};Check $rejected 'duplicate identity rejected'
SaveRegistry @($account)
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../manage-server.ps1'),[ref]$tokens,[ref]$errors)
Check ($errors.Count -eq 0) 'maintenance script parses'
$fn=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'HumanPlayers'},$true)
. ([scriptblock]::Create($fn.Extent.Text))
$opsDir=$out
function PlayerRoster{return [pscustomobject]@{Names=@('HumanWithCLI','RuntimeNoPrefix','ag_Human','OldConfirmed');Uuids=@{HumanWithCLI=$id2;RuntimeNoPrefix=$id3;ag_Human='44444444-4444-4444-8444-444444444444';OldConfirmed=$id1}}}
function NumenBodyUuids{return @()}
function RuntimeControllerUuids{return @($id3)}
$humans=@(HumanPlayers)
Check ($humans -contains 'HumanWithCLI') 'frequent CLI user remains behind human gate'
Check ($humans -contains 'ag_Human') 'ag prefix does not grant maintenance exemption'
Check ($humans -notcontains 'RuntimeNoPrefix') 'handshake works without name convention'
Check ($humans -notcontains 'OldConfirmed') 'legacy confirmation uses UUID'
Check (@(Maintenance-UuidsFromNbt 'x has the following entity data: [I; 0, 0, 0, 1]')[0] -eq '00000000-0000-0000-0000-000000000001') 'NBT UUID decoding'
Write-Output "Client identity: $checks checks passed; production untouched"
