"""Read this process's Windows counters and contain only the Popen child we own."""
import ctypes as C
from ctypes import wintypes as W
import os


class Memory(C.Structure):
    _fields_ = [("cb", W.DWORD), ("PageFaultCount", W.DWORD)] + [
        (name, C.c_size_t) for name in ("PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
        "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage", "PrivateUsage")]


class Performance(C.Structure):
    _fields_ = [("cb", W.DWORD)] + [(name, C.c_size_t) for name in (
        "CommitTotal", "CommitLimit", "CommitPeak", "PhysicalTotal", "PhysicalAvailable", "SystemCache",
        "KernelTotal", "KernelPaged", "KernelNonpaged", "PageSize")] + [(name, W.DWORD) for name in ("HandleCount", "ProcessCount", "ThreadCount")]


class BasicLimit(C.Structure):
    _fields_ = [("PerProcessUserTimeLimit", C.c_longlong), ("PerJobUserTimeLimit", C.c_longlong),
                ("LimitFlags", W.DWORD), ("MinimumWorkingSetSize", C.c_size_t), ("MaximumWorkingSetSize", C.c_size_t),
                ("ActiveProcessLimit", W.DWORD), ("Affinity", C.c_size_t), ("PriorityClass", W.DWORD), ("SchedulingClass", W.DWORD)]


class IoCounters(C.Structure):
    _fields_ = [(name, C.c_ulonglong) for name in ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount", "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]


class ExtendedLimit(C.Structure):
    _fields_ = [("BasicLimitInformation", BasicLimit), ("IoInfo", IoCounters), ("ProcessMemoryLimit", C.c_size_t),
                ("JobMemoryLimit", C.c_size_t), ("PeakProcessMemoryUsed", C.c_size_t), ("PeakJobMemoryUsed", C.c_size_t)]


class Windows:
    def __init__(self):
        if os.name != "nt":
            raise RuntimeError("Actual Windows host required; no substitute GPU measurement")
        self.kernel = C.WinDLL("kernel32", use_last_error=True)
        self.psapi = C.WinDLL("psapi", use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [C.c_void_p, W.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = W.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [W.HANDLE, C.c_int, C.c_void_p, W.DWORD]
        self.kernel.AssignProcessToJobObject.argtypes = [W.HANDLE, W.HANDLE]
        self.kernel.CloseHandle.argtypes = [W.HANDLE]
        self.psapi.GetProcessMemoryInfo.argtypes = [W.HANDLE, C.c_void_p, W.DWORD]
        self.psapi.GetPerformanceInfo.argtypes = [C.c_void_p, W.DWORD]
        self.psapi.EnumProcessModulesEx.argtypes = [W.HANDLE, C.c_void_p, W.DWORD, C.c_void_p, W.DWORD]
        self.psapi.GetModuleFileNameExW.argtypes = [W.HANDLE, W.HMODULE, W.LPWSTR, W.DWORD]

    @staticmethod
    def check(ok):
        if not ok:
            raise C.WinError(C.get_last_error())

    def host(self):
        value = Performance(); value.cb = C.sizeof(value)
        self.check(self.psapi.GetPerformanceInfo(C.byref(value), value.cb))
        return {"hostFreeCommit": (value.CommitLimit-value.CommitTotal)*value.PageSize,
                "hostPhysicalAvailable": value.PhysicalAvailable*value.PageSize}

    def process(self, process):
        value = Memory(); value.cb = C.sizeof(value)
        self.check(self.psapi.GetProcessMemoryInfo(int(process._handle), C.byref(value), value.cb))
        return {"privateBytes": value.PrivateUsage, "workingSetBytes": value.WorkingSetSize,
                "peakWorkingSetBytes": value.PeakWorkingSetSize, "pagefileBytes": value.PagefileUsage,
                "peakPagefileBytes": value.PeakPagefileUsage, **self.host()}

    def contain(self, process, byte_limit):
        job = self.kernel.CreateJobObjectW(None, None)
        self.check(job)
        try:
            limits = ExtendedLimit()
            limits.BasicLimitInformation.LimitFlags = 0x100 | 0x2000  # PROCESS_MEMORY, KILL_ON_JOB_CLOSE
            limits.ProcessMemoryLimit = byte_limit
            self.check(self.kernel.SetInformationJobObject(job, 9, C.byref(limits), C.sizeof(limits)))
            self.check(self.kernel.AssignProcessToJobObject(job, int(process._handle)))
        except BaseException:
            self.kernel.CloseHandle(job)
            raise
        return job

    def modules(self, process):
        modules = (W.HMODULE * 2048)(); needed = W.DWORD()
        self.check(self.psapi.EnumProcessModulesEx(int(process._handle), modules, C.sizeof(modules), C.byref(needed), 3))
        result = []
        for module in modules[:min(len(modules), needed.value // C.sizeof(W.HMODULE))]:
            path = C.create_unicode_buffer(32768)
            if self.psapi.GetModuleFileNameExW(int(process._handle), module, path, len(path)):
                result.append(path.value)
        return result
