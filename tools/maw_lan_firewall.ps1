param(
    [ValidateSet('Plan', 'Apply', 'Status', 'Rollback')][string]$Mode = 'Plan',
    [string]$ReceiptPath,
    [switch]$Bedrock,
    [switch]$Voice,
    [switch]$PublicGameAccess
)
$ErrorActionPreference = 'Stop'
if ($Bedrock -and $Voice) { throw 'Select only one LAN service' }
$group = 'My Agent World LAN 28976'
$ports = @('28976', '28977', '28984')
$description = 'ManagedBy=maw_lan_firewall.ps1; home LAN only; no router changes'
$protocol = 'TCP'
$protocolNumbers = @('TCP','6')
$definitions = @(
    @{ Name='MyAgentWorld.LAN.AllowIPv4'; Action='Allow'; LocalAddress=@('192.168.3.163'); RemoteAddress=@('192.168.3.0/24') },
    @{ Name='MyAgentWorld.LAN.DenyOtherIPv4'; Action='Block'; LocalAddress=@('Any'); RemoteAddress=@('0.0.0.0-126.255.255.255','128.0.0.0-192.168.2.255','192.168.4.0-255.255.255.255') }
)
if ($Bedrock) {
    $group = 'My Agent World Bedrock LAN 28988'
    $ports = @('28988')
    $protocol = 'UDP'
    $protocolNumbers = @('UDP','17')
    $description = 'ManagedBy=maw_lan_firewall.ps1; Bedrock home LAN only; no router changes'
    $definitions[0].Name = 'MyAgentWorld.BedrockLAN.AllowIPv4'
    $definitions[1].Name = 'MyAgentWorld.BedrockLAN.DenyOtherIPv4'
}
if ($Voice) {
    $group = 'My Agent World Voice LAN 28989'
    $ports = @('28989')
    $protocol = 'UDP'
    $protocolNumbers = @('UDP','17')
    $description = 'ManagedBy=maw_lan_firewall.ps1; Java voice home LAN only; no router changes'
    $definitions[0].Name = 'MyAgentWorld.VoiceLAN.AllowIPv4'
    $definitions[1].Name = 'MyAgentWorld.VoiceLAN.DenyOtherIPv4'
}
if ($PublicGameAccess) {
    # Inspect the separately authorized public policy. This mode never writes rules.
    $description = 'Read-only inspection of public game access; management remains local'
    if ($Bedrock -or $Voice) {
        $definitions[0].RemoteAddress = @('Any')
        $definitions[1].Enabled = 'False'
    } else {
        $ports = @('28984')
        $definitions[0].RemoteAddress = @('LocalSubnet')
        $definitions += @{ Name='MyAgentWorld.WAN.Java.Allow'; Action='Allow'; LocalAddress=@('Any'); RemoteAddress=@('Any'); Ports=@('28976','28977'); ByDisplayName=$true }
    }
}
function Read-OwnedRules {
    $rows = @()
    foreach ($definition in $definitions) {
        $rule = if ($definition.ByDisplayName) { Get-NetFirewallRule -DisplayName $definition.Name -ErrorAction SilentlyContinue } else { Get-NetFirewallRule -Name $definition.Name -ErrorAction SilentlyContinue }
        if ($null -eq $rule) { continue }
        if (@($rule).Count -ne 1) { throw ('Ambiguous firewall rule: '+$definition.Name) }
        if (-not $PublicGameAccess -and ($rule.Group -ne $group -or $rule.Description -ne $description)) { throw ('Rule name belongs to another configuration: '+$definition.Name) }
        $address = $rule | Get-NetFirewallAddressFilter
        $port = $rule | Get-NetFirewallPortFilter
        $rows += [ordered]@{Name=$definition.Name;RuleId=$rule.Name;Enabled=[string]$rule.Enabled;Direction=[string]$rule.Direction;Action=[string]$rule.Action;Profile=[string]$rule.Profile;Protocol=[string]$port.Protocol;LocalPort=@($port.LocalPort);LocalAddress=@($address.LocalAddress);RemoteAddress=@($address.RemoteAddress)}
    }
    return $rows
}
function Save-Receipt($receipt) {
    $json=$receipt|ConvertTo-Json -Depth 8
    if ($ReceiptPath) { [IO.File]::WriteAllText($ReceiptPath,$json,[Text.UTF8Encoding]::new($false)) }
    Write-Output $json
}
try {
    if ($PublicGameAccess -and $Mode -ne 'Status') { throw 'PublicGameAccess is read-only; use Mode Status' }
    if ($Mode -eq 'Plan') {
        Save-Receipt ([ordered]@{ok=$true;mode=$Mode;protocol=$protocol;localAddress='192.168.3.163';subnet='192.168.3.0/24';ports=$ports;definitions=$definitions;routerChanged=$false})
        exit 0
    }
    $existing=@(Read-OwnedRules)
    if ($Mode -in @('Apply','Rollback')) {
        $principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
        if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Windows administrator token is required for firewall writes' }
    }
    if ($Mode -eq 'Apply') {
        if (-not (Get-NetIPAddress -AddressFamily IPv4 -IPAddress '192.168.3.163' -ErrorAction SilentlyContinue)) { throw 'Expected home LAN interface is missing' }
        # Create block boundaries first, so a partial failure never broadens access.
        foreach ($definition in @($definitions[1],$definitions[0])) {
            if ($existing.Name -contains $definition.Name) { continue }
            New-NetFirewallRule -Name $definition.Name -DisplayName $definition.Name -Group $group -Description $description -Enabled True -Profile Any -Direction Inbound -Action $definition.Action -Protocol $protocol -LocalPort $ports -LocalAddress $definition.LocalAddress -RemoteAddress $definition.RemoteAddress|Out-Null
        }
    }
    if ($Mode -eq 'Rollback') {
        foreach ($rule in $existing) { Remove-NetFirewallRule -Name $rule.Name }
    }
    $rows=@(Read-OwnedRules)
    if ($Mode -in @('Apply','Status')) {
        if ($rows.Count -ne $definitions.Count) { throw 'Firewall readback count mismatch' }
        foreach ($definition in $definitions) {
            $row=$rows|Where-Object {$_.Name -eq $definition.Name}
            $expectedEnabled = if ($definition.Enabled) { $definition.Enabled } else { 'True' }
            $expectedPorts = if ($definition.Ports) { $definition.Ports } else { $ports }
            if ($row.Enabled -ne $expectedEnabled -or $row.Direction -ne 'Inbound' -or $row.Profile -ne 'Any' -or $row.Action -ne $definition.Action -or $row.Protocol -notin $protocolNumbers -or (@($row.LocalPort|Sort-Object)-join ',') -ne (@($expectedPorts|Sort-Object)-join ',')) { throw 'Firewall enabled/action/port readback mismatch' }
            if (($row.LocalAddress -join ',') -ne ($definition.LocalAddress -join ',')) { throw 'Firewall local-address readback mismatch' }
            # Windows may report a CIDR as its equivalent dotted mask.
            $actual=@($row.RemoteAddress|ForEach-Object {$_ -replace '/255\.255\.255\.0$','/24'}|Sort-Object)
            if (($actual -join ',') -ne (@($definition.RemoteAddress|Sort-Object)-join ',')) { throw 'Firewall remote-address readback mismatch' }
        }
    }
    Save-Receipt ([ordered]@{ok=$true;mode=$Mode;publicGameAccess=[bool]$PublicGameAccess;rules=$rows;routerChanged=$false;at=[DateTime]::UtcNow.ToString('o')})
} catch {
    Save-Receipt ([ordered]@{ok=$false;mode=$Mode;reason=$_.Exception.Message;routerChanged=$false;at=[DateTime]::UtcNow.ToString('o')})
    exit 1
}
