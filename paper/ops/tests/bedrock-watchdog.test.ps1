$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$source=Join-Path $PSScriptRoot '..\manage-server.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Source PowerShell parse failed'}
$definition=@($ast.FindAll({param($n)$n-is[Management.Automation.Language.FunctionDefinitionAst]-and$n.Name-eq'BedrockProbe'},$true))
if($definition.Count-ne 1){throw 'Missing unique probe'}
Invoke-Expression $definition[0].Extent.Text
# Execute the actual function with explicit transport fixtures; no real maintenance runs.
$node='Invoke-ProbeFixture';$serverDir='TestServer';$lanHost='192.168.3.163'
$script:hasConfig=$false;$script:enabled=$true;$script:legacyOk=$true;$script:modern='healthy';$script:calls=@();$script:logs=@()
function Log($message){$script:logs+=$message}
function Test-Path {param($LiteralPath) return $script:hasConfig}
function Get-Content {param($LiteralPath,[switch]$Raw) if($script:enabled){'enabled=true'}else{'enabled=false'}}
function Invoke-ProbeFixture {
    param($path,$hostName,$port,$discoveryPort)
    $script:calls+=$path;$global:LASTEXITCODE=0
    if($path-eq'E:\MC\bedrock-ping.mjs'){if($script:legacyOk){'REPLY MCPE;test'}else{$global:LASTEXITCODE=1;'TIMEOUT'};return}
    if($path-ne'E:\MC\ops\bedrock-network-health.mjs'-or$hostName-ne$lanHost-or$port-ne'19132'-or$discoveryPort-ne'7551'){throw 'Unexpected probe target'}
    switch($script:modern){
        'healthy'{'{"healthy":true}'}
        'failed'{$global:LASTEXITCODE=1;'{"healthy":false,"errors":["LAN_DISCOVERY_TIMEOUT"]}'}
        'false'{'{"healthy":false}'}
        'malformed'{'not json'}
        'string'{'{"healthy":"true"}'}
    }
}
$checks=0
function Expect($expected,$count){$script:calls=@();$actual=BedrockProbe;if($actual-isnot[bool]-or$actual-ne$expected-or$script:calls.Count-ne$count){throw ('Probe result mismatch: '+$actual)};$script:checks++}
Expect $true 1
$script:hasConfig=$true;$script:enabled=$false;Expect $true 1
$script:enabled=$true;Expect $true 2
foreach($mode in @('failed','false','malformed','string')){$script:modern=$mode;Expect $false 2}
$script:legacyOk=$false;Expect $false 1
Write-Output ('Bedrock watchdog: '+$checks+' passed')
# The last fixture intentionally returned a process failure. Do not leak its
# synthetic exit code into the CI shell after all assertions have passed.
$global:LASTEXITCODE=0
