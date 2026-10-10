param([string]$Config = 'E:/MC/ops/ysm-services.json')
$ErrorActionPreference='Stop'
# A Windows job prevents orphaned JVMs after supervisor/launcher failure.
# https://learn.microsoft.com/windows/win32/procthread/job-objects
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class YsmJob {
 [StructLayout(LayoutKind.Sequential)] public struct Basic { public long PerProcess, PerJob; public uint Flags; public UIntPtr Min,Max; public uint Active; public UIntPtr Affinity; public uint Priority,Scheduling; }
 [StructLayout(LayoutKind.Sequential)] public struct Io { public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes; }
 [StructLayout(LayoutKind.Sequential)] public struct Extended { public Basic Basic; public Io Io; public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob; }
 [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr attr,string name);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job,int kind,ref Extended info,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
 public static IntPtr Create() { var h=CreateJobObject(IntPtr.Zero,null); if(h==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(); var info=new Extended(); info.Basic.Flags=0x2000; if(!SetInformationJobObject(h,9,ref info,(uint)Marshal.SizeOf(info))) { CloseHandle(h);throw new System.ComponentModel.Win32Exception(); }return h; }
}
'@
$node='C:/Users/lzl19/AppData/Local/hermes/node/node.exe'
$gate=Join-Path (Split-Path -Parent $Config) ('ysm-start-'+[guid]::NewGuid().ToString('N')+'.gate')
$job=[YsmJob]::Create()
$prior=$env:YSM_START_GATE_FILE
try {
    $env:YSM_START_GATE_FILE=$gate
    $info=New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName=$node
    $info.Arguments='"'+(Join-Path $PSScriptRoot 'ysm-services.mjs')+'" "'+$Config+'"'
    $info.UseShellExecute=$false
    $info.CreateNoWindow=$true
    $process=[System.Diagnostics.Process]::Start($info)
    if(-not [YsmJob]::AssignProcessToJobObject($job,$process.Handle)){throw 'Unable to contain YSM supervisor in Windows job'}
    [IO.File]::WriteAllText($gate,'ready')
    $process.WaitForExit()
    exit $process.ExitCode
} finally {
    $env:YSM_START_GATE_FILE=$prior
    [YsmJob]::CloseHandle($job) | Out-Null
    Remove-Item -LiteralPath $gate -Force -ErrorAction SilentlyContinue
}
