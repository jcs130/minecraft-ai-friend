$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../content-deploy.ps1')
$taskCases = @(
    @('numen-paper-1.21.1-0.1.4.jar', $true),
    @('numen_api-paper-1.21.1-0.1.4.jar', $true),
    @('NumenBedrock-0.1.0.jar', $true),
    @('NumenBedrock-0.1.1.jar', $false),
    @('numenbedrock-0.1.0.jar', $false),
    @('numen-fabric-1.21.1-0.1.4.jar', $false),
    @('numen-neoforge-1.21.1-0.1.4.jar', $false),
    @('numen-paper-1.20.6-0.1.4.jar', $false),
    @('numen-paper-1.21.1-0.1.5.jar', $false),
    @('numen_api-paper-1.21.1-0.1.4-api.jar', $false),
    @('numen-paper-1.21.1-0.1.4.jar.disabled', $false),
    @('Numen-paper-1.21.1-0.1.4.jar', $false),
    @('../numen-paper-1.21.1-0.1.4.jar', $false),
    @('numen-paper-1.21.1-0.1.4.jar/elsewhere', $false),
    @('OtherPlugin-1.21.1-0.1.4.jar', $false)
)
foreach ($taskCase in $taskCases) {
    if ((Content-NumenPaperJar $taskCase[0]) -ne $taskCase[1]) {
        throw ('Unexpected Numen artifact validation: ' + $taskCase[0])
    }
}
Write-Output ('Numen Paper artifact boundary: ' + $taskCases.Count + ' cases passed; no files installed')
