$ErrorActionPreference='Stop'
$root=$PSScriptRoot
if(Test-Path -LiteralPath (Join-Path $root 'children.json')){throw 'Fixture already used'}
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class LifetimeFixture {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr CreateJobObject(IntPtr a,string n);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool SetInformationJobObject(IntPtr j,int c,IntPtr p,uint s);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool AssignProcessToJobObject(IntPtr j,IntPtr p);
 [DllImport("kernel32.dll")]public static extern bool CloseHandle(IntPtr h);
 public static IntPtr Attach(IntPtr process){var j=CreateJobObject(IntPtr.Zero,null);var b=Marshal.AllocHGlobal(144);try{for(int i=0;i<144;i++)Marshal.WriteByte(b,i,0);Marshal.WriteInt32(b,16,0x2800);if(!SetInformationJobObject(j,9,b,144)||!AssignProcessToJobObject(j,process))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());return j;}finally{Marshal.FreeHGlobal(b);}}
}
'@
$shell=Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\v1.0\powershell.exe'
$parent=Start-Process -FilePath $shell -ArgumentList @('-NoProfile','-File',"`"$root\fixture-parent.ps1`"",'-Root',"`"$root`"") -WindowStyle Hidden -PassThru
$job=[LifetimeFixture]::Attach($parent.Handle)
try {
 [IO.File]::WriteAllText((Join-Path $root 'go'),'fixture')
 $deadline=[DateTime]::UtcNow.AddSeconds(30)
 while(-not [IO.File]::Exists((Join-Path $root 'children.json'))){if([DateTime]::UtcNow -gt $deadline){throw 'No fixture children'};Start-Sleep -Milliseconds 100}
 $children=Get-Content -Raw -LiteralPath (Join-Path $root 'children.json') | ConvertFrom-Json
 Start-Sleep -Seconds 1
 $before=(Get-Item -LiteralPath (Join-Path $root 'fixed.beats')).Length
 [LifetimeFixture]::CloseHandle($job)|Out-Null;$job=[IntPtr]::Zero
 Start-Sleep -Seconds 2
 $checks=@{
  parentClosed=($null -eq (Get-Process -Id $parent.Id -ErrorAction SilentlyContinue));
  oldChildKilled=($null -eq (Get-Process -Id $children.legacy -ErrorAction SilentlyContinue));
  fixedChildAlive=($null -ne (Get-Process -Id $children.fixed -ErrorAction SilentlyContinue));
  heartbeatContinues=((Get-Item -LiteralPath (Join-Path $root 'fixed.beats')).Length -gt $before);
  environmentPreserved=((Get-Content -LiteralPath (Join-Path $root 'fixed.beats') -First 1) -match 'env=True');
  stderrEmpty=((Get-Item -LiteralPath (Join-Path $root 'fixed.err')).Length -eq 0)
 }
 $result=@{checks=$checks;passed=(@($checks.Values | Where-Object {-not $_}).Count -eq 0);at=(Get-Date).ToString('o');productionTouched=$false}
 $result|ConvertTo-Json -Depth 4|Set-Content -LiteralPath (Join-Path $root 'lifecycle-test.json')
 $result|ConvertTo-Json -Depth 4
 if(-not $result.passed){throw 'Lifetime fixture failed'}
}finally{
 if($job -ne [IntPtr]::Zero){[LifetimeFixture]::CloseHandle($job)|Out-Null}
 [IO.File]::WriteAllText((Join-Path $root 'stop'),'fixture complete')
}
