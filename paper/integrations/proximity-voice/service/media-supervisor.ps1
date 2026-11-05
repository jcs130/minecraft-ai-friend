param(
 [string]$Root='E:\MC\integrations\proximity-voice-20261029',
 [string]$Python='E:\MC\runtime\qiandeng-voice\Scripts\python.exe',
 [string]$Config='E:\MC\private\proximity-voice\service.json'
)
$ErrorActionPreference='Stop'
function Test-VoiceProcessIdentity($Process,$Parent,[string]$Python,[string]$BasePython,[string]$Script,[string]$Config) {
 # Windows venv python.exe is a launcher. Its child uses the base interpreter,
 # but must still have the exact venv parent and service/config arguments.
 $serviceArguments=' -X utf8 "'+$Script+'" --config "'+$Config+'"'
 $launcher='"'+$Python+'"'+$serviceArguments
 # Windows PowerShell 5.1 appends a trailing space to Start-Process arguments.
 if($Process.ExecutablePath -eq $Python -and ([string]$Process.CommandLine).TrimEnd() -ceq $launcher){return $true}
 return $null -ne $Parent -and $Process.ParentProcessId -eq $Parent.ProcessId -and
  $Parent.ExecutablePath -eq $Python -and ([string]$Parent.CommandLine).TrimEnd() -ceq $launcher -and
  $Process.ExecutablePath -eq $BasePython -and ([string]$Process.CommandLine).TrimEnd() -ceq ('"'+$BasePython+'"'+$serviceArguments)
}
$script=Join-Path $Root 'voice_service.py'
$stop=Join-Path $Root 'service.stop'
if(-not(Test-Path -LiteralPath $Python -PathType Leaf)){throw 'Voice virtual environment is missing; restore service/requirements.txt before starting.'}
# The base Python intentionally has no media packages. Validate the interpreter
# used by this task, rather than a different Python found on PATH.
$basePython=& $Python -c 'import sys, numpy, scipy.signal, sherpa_onnx; print(sys._base_executable)'
if($LASTEXITCODE -ne 0){throw 'Voice dependencies are unavailable in the configured interpreter; do not start a restart loop.'}
if(-not $basePython){throw 'Cannot identify the voice environment base interpreter'}
$lock=$null
try {
 $lock=[IO.File]::Open((Join-Path $Root 'supervisor.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 while(-not(Test-Path -LiteralPath $stop)){
  $listeners=@(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8857 -State Listen -ErrorAction SilentlyContinue)
  if($listeners.Count -gt 1){throw 'Multiple media listeners'}
  $adopted=$listeners.Count -eq 1
  if($adopted){
   $proc=Get-CimInstance Win32_Process -Filter ('ProcessId='+$listeners[0].OwningProcess)
   $parent=if($proc){Get-CimInstance Win32_Process -Filter ('ProcessId='+$proc.ParentProcessId)}else{$null}
   if(-not(Test-VoiceProcessIdentity $proc $parent $Python $basePython $script $Config)){throw 'Refusing to adopt unrelated media listener'}
   $child=Get-Process -Id $proc.ProcessId
  }else{
   $stamp=Get-Date -Format yyyyMMdd-HHmmss
   $child=Start-Process -FilePath $Python -ArgumentList @('-X','utf8',('"'+$script+'"'),'--config',('"'+$Config+'"')) -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Root ('media-'+$stamp+'.log')) -RedirectStandardError (Join-Path $Root ('media-'+$stamp+'.error.log')) -PassThru
  }
  while(-not $child.HasExited -and -not(Test-Path -LiteralPath $stop)){
   $ready=$false
   try {
    $health=Invoke-RestMethod -Uri 'http://127.0.0.1:8857/health' -TimeoutSec 3
    $ready=$health.ok -eq $true -and $health.asrLoaded -eq $true -and $health.asrDevice -eq 'cpu'
   }catch [System.Net.WebException] { }
   @{at=(Get-Date).ToString('o');pid=$child.Id;adoptedOriginal=$adopted;loopbackOnly=$true;ready=$ready;python=$Python}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $Root 'supervisor-status.json') -Encoding UTF8
   Start-Sleep -Seconds 5
  }
  if(-not(Test-Path -LiteralPath $stop)){Start-Sleep -Seconds 15}
 }
}finally{if($lock){$lock.Dispose()}}
