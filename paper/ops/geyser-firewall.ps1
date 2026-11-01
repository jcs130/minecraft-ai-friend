param([switch]$Apply,[Parameter(Mandatory=$true)][string]$EvidenceRoot,[Parameter(Mandatory=$true)][string]$MirrorRoot)
$ErrorActionPreference='Stop'
Import-Module NetSecurity -ErrorAction Stop
$java='E:\MC\jdk\jdk-21.0.12.1+1\bin\java.exe'
if(-not(Test-Path -LiteralPath $java -PathType Leaf)){throw 'Reviewed game Java executable missing'}
$specs=@(@{name='Qiandengji-Geyser-Signaling';protocol='TCP';port=19132},@{name='Qiandengji-Geyser-WebRTC';protocol='UDP';port=19133})
$before=@()
foreach($s in $specs){
 $rule=Get-NetFirewallRule -Name $s.name -ErrorAction SilentlyContinue
 if($rule){
  $port=$rule|Get-NetFirewallPortFilter;$app=$rule|Get-NetFirewallApplicationFilter;$address=$rule|Get-NetFirewallAddressFilter
  if($rule.Direction-ne'Inbound'-or$rule.Action-ne'Allow'-or$rule.Enabled-ne'True'-or$rule.Profile-ne'Any'-or$port.Protocol-ne$s.protocol-or[string]$port.LocalPort-ne[string]$s.port-or$app.Program-ne$java-or[string]$address.RemoteAddress-ne'Any'){throw ('Existing rule differs; preserve for operator review: '+$s.name)}
 }
 $before+=@{name=$s.name;present=[bool]$rule;protocol=$s.protocol;port=$s.port;program=$java}
}
if(-not$Apply){[pscustomobject]@{passed=$true;applied=$false;rules=$before}|ConvertTo-Json -Depth 5;return}
if(-not([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Firewall changes require Windows administrator confirmation'}
foreach($root in @($EvidenceRoot,$MirrorRoot)){
 if(-not(Test-Path -LiteralPath $root -PathType Container)){throw 'Evidence root must already exist'}
 if(Test-Path -LiteralPath (Join-Path $root 'firewall-before.json')){throw 'Firewall entry already consumed; inspect its evidence'}
 $before|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $root 'firewall-before.json') -Encoding UTF8
}
foreach($s in $specs){
 if(-not(Get-NetFirewallRule -Name $s.name -ErrorAction SilentlyContinue)){New-NetFirewallRule -Name $s.name -DisplayName $s.name -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol $s.protocol -LocalPort $s.port -Program $java|Out-Null}
 $r=Get-NetFirewallRule -Name $s.name;$p=$r|Get-NetFirewallPortFilter;$a=$r|Get-NetFirewallApplicationFilter
 if($r.Enabled-ne'True'-or$p.Protocol-ne$s.protocol-or[string]$p.LocalPort-ne[string]$s.port-or$a.Program-ne$java){throw 'Firewall readback failed'}
}
[pscustomobject]@{passed=$true;applied=$true;rules=$before;existingRakNetRuleUnchanged=$true}|ConvertTo-Json -Depth 5
