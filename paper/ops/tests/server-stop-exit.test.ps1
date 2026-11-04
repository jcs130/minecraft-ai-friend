param([string]$Source=(Join-Path (Split-Path -Parent $PSScriptRoot) 'manage-server.ps1'),[string]$Output=(Join-Path ([IO.Path]::GetTempPath()) ('mc-stop-exit-'+[guid]::NewGuid().ToString('N'))))
$ErrorActionPreference='Stop'
$nativeModules=Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\v1.0\Modules'
foreach($name in @('Microsoft.PowerShell.Utility','Microsoft.PowerShell.Management')){Import-Module (Join-Path $nativeModules ($name+'\'+$name+'.psd1')) -ErrorAction Stop}
if(Test-Path -LiteralPath $Output){throw 'Use a fresh owned fixture directory'}
New-Item -ItemType Directory -Path $Output|Out-Null
$outputPath=[IO.Path]::GetFullPath($Output)
$childScript=Join-Path $outputPath 'child.ps1'
[IO.File]::WriteAllText($childScript,@'
param([string]$Root)
[IO.File]::WriteAllText((Join-Path $Root 'listening'),'yes')
while(-not[IO.File]::Exists((Join-Path $Root 'stop.request'))){[Threading.Thread]::Sleep(20)}
[IO.File]::Delete((Join-Path $Root 'listening'))
[Threading.Thread]::Sleep(2500)
[IO.File]::WriteAllText((Join-Path $Root 'final-gc.log'),'final write after listener close')
[Threading.Thread]::Sleep(200)
'@)
$child=Start-Process -FilePath 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -ArgumentList @('-NoProfile','-File',('"'+$childScript+'"'),('"'+$outputPath+'"')) -WindowStyle Hidden -PassThru
try{
 $limit=(Get-Date).AddSeconds(15);while(-not(Test-Path -LiteralPath (Join-Path $outputPath 'listening'))){if((Get-Date)-gt$limit){throw 'Fixture child did not start'};Start-Sleep -Milliseconds 50}
 $tokens=$null;$parseErrors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($Source,[ref]$tokens,[ref]$parseErrors)
 $method=@($ast.FindAll({param($n)$n-is[Management.Automation.Language.FunctionDefinitionAst]-and$n.Name-eq'Stop-Server'},$true));if($parseErrors.Count-or$method.Count-ne 1){throw 'Invalid reviewed stop function'}
 Invoke-Expression $method[0].Extent.Text
 function Listener {if(Test-Path -LiteralPath (Join-Path $outputPath 'listening')){[pscustomobject]@{OwningProcess=$child.Id}}}
 function Stop-AgentEyeWatcher{};function Stop-SpectateWatcher{};function Stop-Goddess{};function Stop-Gateway{param([switch]$RetainProtectedGateway)};function Stop-YsmServices{};function Probe{}
 function Rcon([string]$command){if($command-eq'stop'){[IO.File]::WriteAllText((Join-Path $outputPath 'stop.request'),'stop')}}
 function Log([string]$line){}
 $watch=[Diagnostics.Stopwatch]::StartNew();Stop-Server;$watch.Stop();$child.Refresh()
 $proof=@{listenerClosed=-not[IO.File]::Exists((Join-Path $outputPath 'listening'));processExited=$child.HasExited;finalWritePresent=[IO.File]::Exists((Join-Path $outputPath 'final-gc.log'));elapsedMs=$watch.ElapsedMilliseconds;productionChanged=$false}
 $proof|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $outputPath 'result.json') -Encoding UTF8
 $proof|ConvertTo-Json
 if(-not$proof.processExited-or-not$proof.finalWritePresent){throw 'Stop returned before the final JVM write'}
}finally{if(-not$child.HasExited){$child.WaitForExit(10000)|Out-Null};if(-not$child.HasExited){$child.Kill()};$child.Dispose()}
