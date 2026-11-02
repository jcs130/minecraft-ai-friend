using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Qiandengji.Operations {
    // A maintenance shell may belong to the desktop app's kill-on-close job.
    // Hidden windows and Start-Process alone do not detach that lifetime.
    public static class IndependentProcess {
        [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes {
            public int Length; public IntPtr Descriptor; public int Inherit;
        }
        [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct StartupInfo {
            public int Size; public string Reserved, Desktop, Title;
            public int X,Y,XSize,YSize,XChars,YChars,Fill,Flags;
            public short Show,ReservedSize; public IntPtr ReservedData,Input,Output,Error;
        }
        [StructLayout(LayoutKind.Sequential)] struct ProcessInformation {
            public IntPtr Process,Thread; public int Id,ThreadId;
        }
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
        static extern IntPtr CreateFile(string name,uint access,uint share,ref SecurityAttributes sa,uint creation,uint flags,IntPtr template);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
        static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string directory,ref StartupInfo startup,out ProcessInformation process);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool inJob);
        [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        static IntPtr Open(string path,uint access,uint creation) {
            var sa=new SecurityAttributes{Length=Marshal.SizeOf(typeof(SecurityAttributes)),Inherit=1};
            var h=CreateFile(path,access,7,ref sa,creation,0x80,IntPtr.Zero);
            if(h==new IntPtr(-1))throw new Win32Exception(Marshal.GetLastWin32Error(),"Cannot open service standard stream");
            return h;
        }
        public static Process Start(string executable,string arguments,string directory,string stdout,string stderr) {
            if(executable.IndexOf('"')>=0)throw new ArgumentException("Invalid executable path");
            IntPtr input=IntPtr.Zero,output=IntPtr.Zero,error=IntPtr.Zero;
            var pi=new ProcessInformation(); bool resumed=false;
            try {
                input=Open("NUL",0x80000000,3);
                output=Open(stdout,0x40000000,1); error=Open(stderr,0x40000000,1);
                var si=new StartupInfo{Size=Marshal.SizeOf(typeof(StartupInfo)),Flags=0x101,Show=0,Input=input,Output=output,Error=error};
                // BREAKAWAY + NEW_CONSOLE (hidden, retaining normal Ctrl+C recovery) + SUSPENDED.
                if(!CreateProcess(executable,new StringBuilder("\""+executable+"\" "+arguments),IntPtr.Zero,IntPtr.Zero,true,0x01000014,IntPtr.Zero,directory,ref si,out pi))
                    throw new Win32Exception(Marshal.GetLastWin32Error(),"Independent service start refused; no attached fallback was launched");
                bool inJob;
                if(!IsProcessInJob(pi.Process,IntPtr.Zero,out inJob)||inJob)
                    throw new InvalidOperationException("Service still belongs to a parent job; refused before executing it");
                if(ResumeThread(pi.Thread)==0xffffffff)throw new Win32Exception(Marshal.GetLastWin32Error());
                resumed=true;
                return Process.GetProcessById(pi.Id);
            } finally {
                if(!resumed && pi.Process!=IntPtr.Zero)TerminateProcess(pi.Process,1);
                if(pi.Thread!=IntPtr.Zero)CloseHandle(pi.Thread);
                if(pi.Process!=IntPtr.Zero)CloseHandle(pi.Process);
                foreach(var h in new[]{input,output,error})if(h!=IntPtr.Zero)CloseHandle(h);
            }
        }
    }
}
