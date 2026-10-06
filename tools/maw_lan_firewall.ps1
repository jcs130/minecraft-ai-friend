param(
    [ValidateSet('Plan', 'Apply', 'Status', 'Rollback')][string]$Mode = 'Plan',
    [string]$ReceiptPath
)
$ErrorActionPreference = 'Stop'
$group = 'My Agent World LAN 28976'
$ports = @('28976', '28977', '28984')
$description = 'ManagedBy=maw_lan_firewall.ps1; home LAN only; no router changes'
$definitions = @(
    @{ Name='MyAgentWorld.LAN.AllowIPv4'; Action='Allow'; LocalAddress=@('192.168.3.163'); RemoteAddress=@('192.168.3.0/24') },
    @{ Name='MyAgentWorld.LAN.DenyOtherIPv4'; Action='Block'; LocalAddress=@('Any'); RemoteAddress=@('0.0.0.0-126.255.255.255','128.0.0.0-192.168.2.255','192.168.4.0-255.255.255.255') }
)
function Read-OwnedRules {
    $rows = @()
    foreach ($definition in $definitions) {
        $rule = Get-NetFirewallRule -Name $definition.Name -ErrorAction SilentlyContinue
        if ($null -eq $rule) { continue }
        if ($rule.Group -ne $group -or $rule.Description -ne $description) { throw ('Rule name belongs to another configuration: '+$definition.Name) }
        $address = $rule | Get-NetFirewallAddressFilter
        $port = $rule | Get-NetFirewallPortFilter
        $rows += [ordered]@{Name=$rule.Name;Enabled=[string]$rule.Enabled;Direction=[string]$rule.Direction;Action=[string]$rule.Action;Profile=[string]$rule.Profile;Protocol=[string]$port.Protocol;LocalPort=@($port.LocalPort);LocalAddress=@($address.LocalAddress);RemoteAddress=@($address.RemoteAddress)}
    }
    return $rows
}
function Save-Receipt($receipt) {
    $json=$receipt|ConvertTo-Json -Depth 8
    if ($ReceiptPath) { [IO.File]::WriteAllText($ReceiptPath,$json,[Text.UTF8Encoding]::new($false)) }
    Write-Output $json
}
try {
    if ($Mode -eq 'Plan') {
        Save-Receipt ([ordered]@{ok=$true;mode=$Mode;localAddress='192.168.3.163';subnet='192.168.3.0/24';ports=$ports;definitions=$definitions;routerChanged=$false})
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
            New-NetFirewallRule -Name $definition.Name -DisplayName $definition.Name -Group $group -Description $description -Enabled True -Profile Any -Direction Inbound -Action $definition.Action -Protocol TCP -LocalPort $ports -LocalAddress $definition.LocalAddress -RemoteAddress $definition.RemoteAddress|Out-Null
        }
    }
    if ($Mode -eq 'Rollback') {
        foreach ($rule in $existing) { Remove-NetFirewallRule -Name $rule.Name }
    }
    $rows=@(Read-OwnedRules)
    if ($Mode -eq 'Apply') {
        if ($rows.Count -ne 2) { throw 'Firewall readback count mismatch' }
        foreach ($definition in $definitions) {
            $row=$rows|Where-Object {$_.Name -eq $definition.Name}
            if ($row.Enabled -ne 'True' -or $row.Direction -ne 'Inbound' -or $row.Profile -ne 'Any' -or $row.Action -ne $definition.Action -or $row.Protocol -notin @('TCP','6') -or (@($row.LocalPort|Sort-Object)-join ',') -ne (@($ports|Sort-Object)-join ',')) { throw 'Firewall enabled/action/port readback mismatch' }
            if (($row.LocalAddress -join ',') -ne ($definition.LocalAddress -join ',')) { throw 'Firewall local-address readback mismatch' }
            # Windows may report a CIDR as its equivalent dotted mask.
            $actual=@($row.RemoteAddress|ForEach-Object {$_ -replace '/255\.255\.255\.0$','/24'}|Sort-Object)
            if (($actual -join ',') -ne (@($definition.RemoteAddress|Sort-Object)-join ',')) { throw 'Firewall remote-address readback mismatch' }
        }
    }
    Save-Receipt ([ordered]@{ok=$true;mode=$Mode;rules=$rows;routerChanged=$false;at=[DateTime]::UtcNow.ToString('o')})
} catch {
    Save-Receipt ([ordered]@{ok=$false;mode=$Mode;reason=$_.Exception.Message;routerChanged=$false;at=[DateTime]::UtcNow.ToString('o')})
    exit 1
}
