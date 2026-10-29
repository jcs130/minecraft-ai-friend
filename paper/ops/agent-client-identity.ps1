# Maintenance classification only. Never grants login, OP or anti-cheat exemptions.
function Maintenance-OwnerAgentUuids([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return @() }
    $registry=Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($registry.schema -ne 1 -or @($registry.accounts).Count -gt 128) { throw 'Invalid maintenance identity registry' }
    $seen=@{}
    foreach ($account in @($registry.accounts)) {
        $uuid=[string]$account.uuid
        if ($uuid -notmatch '^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' -or
            $account.kind -notin @('agent','observer','service') -or
            $account.source -ne 'owner_confirmation' -or $account.reconnectAllowed -isnot [bool]) {
            throw 'Unverified maintenance identity record'
        }
        $uuid=$uuid.ToLowerInvariant()
        if($seen.ContainsKey($uuid)){throw 'Duplicate maintenance identity'}
        $seen[$uuid]=$true
        if($account.reconnectAllowed){$uuid}
    }
}

function Maintenance-UuidsFromNbt([string]$reply) {
    foreach ($body in [regex]::Matches($reply, 'has the following entity data: \[I; (-?\d+), (-?\d+), (-?\d+), (-?\d+)\]')) {
        $hex=(1..4 | ForEach-Object { ([int]$body.Groups[$_].Value).ToString('x8') }) -join ''
        '{0}-{1}-{2}-{3}-{4}' -f $hex.Substring(0,8),$hex.Substring(8,4),$hex.Substring(12,4),$hex.Substring(16,4),$hex.Substring(20,12)
    }
}
