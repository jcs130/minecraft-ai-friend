$ErrorActionPreference = 'Stop'
$state = 'D:\Projects\QiandengJi\server\drama3-service'
New-Item -ItemType Directory -Path $state -Force | Out-Null
$result = Join-Path $state 'drama-rs-switch-result.json'
$log = Join-Path $state 'drama-rs-switch.log'
Remove-Item -LiteralPath $result -ErrorAction SilentlyContinue
try {
    & (Join-Path $PSScriptRoot 'Switch-Drama3Rs.ps1') *> $log
    @{ ok = $true; completed_at = (Get-Date).ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath $result -Encoding UTF8
    exit 0
} catch {
    $_ | Out-String | Add-Content -LiteralPath $log -Encoding UTF8
    @{ ok = $false; completed_at = (Get-Date).ToString('o'); error = $_.Exception.Message } |
        ConvertTo-Json | Set-Content -LiteralPath $result -Encoding UTF8
    exit 1
}
