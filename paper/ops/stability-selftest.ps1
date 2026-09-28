$ErrorActionPreference = 'Stop'
$scriptPath = 'E:\MC\ops\manage-server.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0] }
$definition = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Check-BedrockHealth'
}, $true)
if (-not $definition) { throw 'Missing Check-BedrockHealth' }
Invoke-Expression $definition.Extent.Text

$bedrockHealthFile = Join-Path $env:TEMP "mc-bedrock-health-test-$PID.json"
$script:probeHealthy = $false
$script:humanNames = @()
$script:stops = 0
$script:starts = 0
$script:messages = @()
function BedrockProbe { $script:probeHealthy }
function HumanPlayers { $script:humanNames }
function Stop-Server { $script:stops++ }
function Start-Server { $script:starts++ }
function Log([string]$message) { $script:messages += $message }
try {
    Check-BedrockHealth
    Check-BedrockHealth
    if ($script:stops -ne 0) { throw 'Restarted on transient failures' }
    $script:humanNames = @('.BedrockGuest')
    Check-BedrockHealth
    if ($script:stops -ne 0 -or -not (Get-Content $bedrockHealthFile -Raw | ConvertFrom-Json).deferred) {
        throw 'Did not defer recovery for human player'
    }
    $script:humanNames = @()
    Check-BedrockHealth
    if ($script:stops -ne 1 -or $script:starts -ne 1) { throw 'Did not perform one service-only recovery' }
    Check-BedrockHealth
    if ($script:stops -ne 1) { throw 'Repeated an unsuccessful recovery' }
    $script:probeHealthy = $true
    Check-BedrockHealth
    if (Test-Path $bedrockHealthFile) { throw 'Recovery state did not clear' }
    Write-Host 'PASS: transient failures, human deferral, one recovery per outage, and reset'
} finally {
    Remove-Item -LiteralPath $bedrockHealthFile -Force -ErrorAction SilentlyContinue
}
