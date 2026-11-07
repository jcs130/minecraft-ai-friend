param([string]$Source=(Join-Path $PSScriptRoot '..\bedrock-lan-firewall.ps1'))
$ErrorActionPreference='Stop'
$global:bedrockFirewallTestCase='';$global:bedrockFirewallTestCreated=@()
function Test-Path { return $true }
function Get-NetFirewallRule {
 param($Name,$ErrorAction)
 if($global:bedrockFirewallTestCase-eq'missing'){return $null}
 $value=[pscustomobject]@{Name=$Name;Enabled='True';Direction='Inbound';Action='Allow'}
 if($global:bedrockFirewallTestCase-eq'disabled'){$value.Enabled='False'}
 return $value
}
function Get-NetFirewallPortFilter {
 param([Parameter(ValueFromPipeline=$true)]$InputObject)
 process{[pscustomobject]@{Protocol='UDP';LocalPort=if($global:bedrockFirewallTestCase-eq'wrong-port'){'25565'}elseif($InputObject.Name-like'*Discovery'){'7551'}else{'19134'}}}
}
function Get-NetFirewallAddressFilter {
 $value=switch($global:bedrockFirewallTestCase){
  'scalar-prefix'{'192.168.3.0/24'}
  'array-mask'{,@('192.168.3.0/255.255.255.0')}
  'any'{'Any'}
  'wide'{'192.168.0.0/16'}
  'extra'{,@('192.168.3.0/24','10.0.0.0/8')}
  default{'192.168.3.0/255.255.255.0'}
 }
 [pscustomobject]@{RemoteAddress=$value}
}
function Get-NetFirewallApplicationFilter {
 [pscustomobject]@{Program=if($global:bedrockFirewallTestCase-eq'wrong-program'){'Any'}else{'E:\MC\jdk\jdk-21.0.12.1+1\bin\java.exe'}}
}
function New-NetFirewallRule {
 param($Name,$DisplayName,$Direction,$Action,$Enabled,$Profile,$Protocol,$LocalPort,$RemoteAddress,$Program)
 if($Direction-ne'Inbound'-or$Action-ne'Allow'-or$Protocol-ne'UDP'-or$RemoteAddress-cne'192.168.3.0/24'-or$LocalPort-notin@(7551,19134)-or$Program-cne'E:\MC\jdk\jdk-21.0.12.1+1\bin\java.exe'){throw 'Unexpected firewall mutation'}
 $global:bedrockFirewallTestCreated+=,$Name
 [pscustomobject]@{Name=$Name;Enabled='True';Direction=$Direction;Action=$Action}
}
$passed=0
foreach($global:bedrockFirewallTestCase in @('scalar-prefix','scalar-mask','array-mask')){
 $result=& $Source -Mode Verify|ConvertFrom-Json
 if(-not$result.passed-or$global:bedrockFirewallTestCreated.Count){throw "Valid representation rejected: $global:bedrockFirewallTestCase"};$passed++
}
foreach($global:bedrockFirewallTestCase in @('any','wide','extra','wrong-port','wrong-program','disabled','missing')){
 $caught=$false
 try{& $Source -Mode Verify|Out-Null}catch{if($_.Exception.Message-like'LAN rule differs*'-or$_.Exception.Message-like'Missing LAN rule*'){$caught=$true}else{throw}}
 if(-not$caught-or$global:bedrockFirewallTestCreated.Count){throw "Unsafe rule accepted/changed: $global:bedrockFirewallTestCase"};$passed++
}
$global:bedrockFirewallTestCase='missing';$result=& $Source -Mode Install|ConvertFrom-Json
if(-not$result.passed-or$global:bedrockFirewallTestCreated.Count-ne 2-or$result.wanChanged){throw 'Install contract changed'};$passed++
[pscustomobject]@{passed=$passed;failed=0;productionChanged=$false}|ConvertTo-Json
