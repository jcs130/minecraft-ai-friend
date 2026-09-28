param([Parameter(Mandatory=$true)][int]$TargetPid)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ConsoleSignal {
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint processId);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint eventType, uint processGroupId);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
}
'@
# Run in a separate PowerShell process. Ignore our own Ctrl+C while delivering
# the event to the console attached to the target Java process.
[ConsoleSignal]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null
[ConsoleSignal]::FreeConsole() | Out-Null
if (-not [ConsoleSignal]::AttachConsole([uint32]$TargetPid)) {
    throw "AttachConsole failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
try {
    if (-not [ConsoleSignal]::GenerateConsoleCtrlEvent(0, 0)) {
        throw "GenerateConsoleCtrlEvent failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
} finally { [ConsoleSignal]::FreeConsole() | Out-Null }
