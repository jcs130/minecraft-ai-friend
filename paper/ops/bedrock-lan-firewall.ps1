param([ValidateSet('Verify','Install')][string]$Mode='Verify')
$ErrorActionPreference='Stop'
# LAN discovery must never create a WAN/router mapping or broaden an existing rule.
$program='E:\MC\jdk\jdk-21.0.12.1+1\bin\java.exe'
$network='192.168.3.0/24'
$specs=@(
    @{Name='Qiandengji-Geyser-LAN-Discovery';Port=7551},
    @{Name='Qiandengji-Geyser-LAN-ICE';Port=19134}
)
if(-not(Test-Path -LiteralPath $program -PathType Leaf)){throw 'Pinned Java runtime missing'}
$created=@()
foreach($spec in $specs){
    $rule=Get-NetFirewallRule -Name $spec.Name -ErrorAction SilentlyContinue
    if(-not $rule){
        if($Mode -eq 'Verify'){throw ('Missing LAN rule: '+$spec.Name)}
        $rule=New-NetFirewallRule -Name $spec.Name -DisplayName $spec.Name -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol UDP -LocalPort $spec.Port -RemoteAddress $network -Program $program
        $created+=$spec.Name
    }
    $port=$rule|Get-NetFirewallPortFilter
    $address=$rule|Get-NetFirewallAddressFilter
    $application=$rule|Get-NetFirewallApplicationFilter
    if(@($rule).Count-ne 1-or$rule.Enabled-ne'True'-or$rule.Direction-ne'Inbound'-or$rule.Action-ne'Allow'-or$port.Protocol-ne'UDP'-or[string]$port.LocalPort-cne[string]$spec.Port-or@($address.RemoteAddress).Count-ne 1-or$address.RemoteAddress[0]-notin@($network,'192.168.3.0/255.255.255.0')-or-not$application.Program.Equals($program,[StringComparison]::OrdinalIgnoreCase)){
        throw ('LAN rule differs; preserve it for review: '+$spec.Name)
    }
}
[pscustomobject]@{passed=$true;mode=$Mode;created=$created;scope=$network;udpPorts=@(7551,19134);wanChanged=$false}|ConvertTo-Json -Depth 4
