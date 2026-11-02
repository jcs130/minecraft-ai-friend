param([string]$LaunchRequest)
# Same user, permissions, environment and existing lifecycle; only the parent job
# association changes. No new service, task, credentials or watchdog is created.
function Start-IndependentProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [Parameter(Mandatory=$true)][string[]]$ArgumentList,
        [Parameter(Mandatory=$true)][string]$WorkingDirectory,
        [ValidateSet('Hidden')][string]$WindowStyle='Hidden',
        [Parameter(Mandatory=$true)][string]$RedirectStandardOutput,
        [Parameter(Mandatory=$true)][string]$RedirectStandardError,
        [switch]$PassThru
    )
    $ErrorActionPreference='Stop'
    $exe=(Get-Command $FilePath -CommandType Application -ErrorAction Stop).Source
    # WMI is the existing Windows process broker, outside the requesting desktop
    # application's nested jobs. Environment stays in memory, never on disk or
    # on a command line (the Goddess login secret is an environment variable).
    $queue=Join-Path $PSScriptRoot '.process-start'
    [IO.Directory]::CreateDirectory($queue) | Out-Null
    $request=Join-Path $queue (([guid]::NewGuid().ToString('N'))+'.json')
    $receipt=$request+'.result'
    $spec=@{executable=$exe;arguments=($ArgumentList -join ' ');directory=$WorkingDirectory;stdout=$RedirectStandardOutput;stderr=$RedirectStandardError}
    [IO.File]::WriteAllText($request,($spec|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
    $startup=New-CimInstance -CimClass (Get-CimClass Win32_ProcessStartup) -ClientOnly
    $startup.ShowWindow=0; $startup.CreateFlags=0x01000010
    $startup.EnvironmentVariables=[string[]]@([Environment]::GetEnvironmentVariables().GetEnumerator() | ForEach-Object { $_.Key+'='+$_.Value })
    $shell=Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\v1.0\powershell.exe'
    $relay=Join-Path $PSScriptRoot 'independent-process.ps1'
    $command='"'+$shell+'" -NoProfile -ExecutionPolicy Bypass -File "'+$relay+'" -LaunchRequest "'+$request+'"'
    $created=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$command;CurrentDirectory=$PSScriptRoot;ProcessStartupInformation=$startup}
    if($created.ReturnValue -ne 0){Remove-Item -LiteralPath $request -Force;throw ('Windows process broker refused startup: '+$created.ReturnValue)}
    $deadline=[DateTime]::UtcNow.AddSeconds(25)
    while(-not [IO.File]::Exists($receipt)){
        if([DateTime]::UtcNow -gt $deadline){throw 'Independent launch outcome unknown; inspect the receipt and service before retrying'}
        Start-Sleep -Milliseconds 100
    }
    $result=[IO.File]::ReadAllText($receipt)|ConvertFrom-Json
    if(-not $result.ok){throw ('Independent launch failed: '+$result.error)}
    $process=Get-Process -Id $result.pid -ErrorAction Stop
    if($process.StartTime.ToUniversalTime().Ticks -ne [long]$result.startedTicks){throw 'Independent process identity changed'}
    Remove-Item -LiteralPath $receipt -Force
    if($PassThru){return $process}
}

if($LaunchRequest){
    $ErrorActionPreference='Stop'
    $queue=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '.process-start'))+[IO.Path]::DirectorySeparatorChar
    $path=[IO.Path]::GetFullPath($LaunchRequest)
    if(-not $path.StartsWith($queue,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($path) -notmatch '^[a-f0-9]{32}\.json$'){throw 'Invalid launch request path'}
    try {
        $spec=[IO.File]::ReadAllText($path)|ConvertFrom-Json
        Add-Type -Path (Join-Path $PSScriptRoot 'IndependentProcess.cs')
        $p=[Qiandengji.Operations.IndependentProcess]::Start($spec.executable,$spec.arguments,$spec.directory,$spec.stdout,$spec.stderr)
        $result=@{ok=$true;pid=$p.Id;startedTicks=$p.StartTime.ToUniversalTime().Ticks;independent=$true}
    } catch {$result=@{ok=$false;error=$_.Exception.Message}}
    finally {Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue}
    $temp=$path+'.writing'
    [IO.File]::WriteAllText($temp,($result|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
    [IO.File]::Move($temp,$path+'.result')
}
