$ErrorActionPreference = 'Stop'
$stateDir = 'D:\Projects\QiandengJi\server\drama3-service'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$log = Join-Path $stateDir 'install-system.log'
$result = Join-Path $stateDir 'install-system-result.json'
try {
    & (Join-Path $PSScriptRoot 'Install-Drama3Service.ps1') -Mode System *> $log
    @{ ok = $true; completed_at = (Get-Date).ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath $result -Encoding UTF8
    exit 0
} catch {
    $_ | Out-String | Add-Content -LiteralPath $log -Encoding UTF8
    @{ ok = $false; completed_at = (Get-Date).ToString('o'); error = $_.Exception.Message } |
        ConvertTo-Json | Set-Content -LiteralPath $result -Encoding UTF8
    exit 1
}
