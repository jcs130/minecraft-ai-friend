"""Own one dedicated Windows photo renderer. Never controls a player or a model service."""
import argparse
import ctypes
from ctypes import wintypes
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time


def configuration(file):
    value = json.loads(Path(file).read_text(encoding='utf-8-sig'))
    for name in ['gameDir', 'java', 'launcher', 'python', 'node', 'loginHelper',
                 'stateDir', 'pauseFile', 'authHeartbeat']:
        if not Path(value[name]).is_absolute():
            raise ValueError('Expected an absolute operator path: ' + name)
    if value['server'] != '192.168.3.163:25565':
        raise ValueError('Unreviewed native camera endpoint')
    gpu=value.get('expectedGpu','intel')
    if gpu not in ('intel','rtx3080ti'):
        raise ValueError('Unreviewed renderer GPU profile')
    if gpu=='intel' and (value.get('maximumPrivateGiB') != 8 or value.get('shadersEnabled') is not False):
        raise ValueError('Unreviewed renderer resource policy')
    if gpu=='rtx3080ti' and (value.get('maximumPrivateGiB') != 6 or value.get('shadersEnabled') is not True
                            or not re.fullmatch(r'GPU-[0-9a-fA-F-]{36}',value.get('gpuUuid',''))):
        raise ValueError('RTX camera requires an explicit adapter UUID and bounded shader policy')
    if value.get('expectedUuid') != 'ff58a81b-f033-3b74-a7cf-58ac4e798bb0':
        raise ValueError('Unreviewed camera identity')
    return value


def renderer_matches(state,cfg):
    renderer=state.get('renderer','').lower()
    if cfg.get('expectedGpu','intel')=='intel':
        return 'intel' in renderer and state.get('shadersEnabled') is False
    return (state.get('vendor')=='NVIDIA Corporation'
            and re.fullmatch(r'nvidia geforce rtx 3080 ti(?:/.*)?',renderer) is not None
            and state.get('expectedGpu')=='rtx3080ti' and state.get('shadersEnabled') is True)


def gpu_free_mib(cfg,run=subprocess.run):
    """Read only the explicitly selected GPU; an unavailable reading is not free VRAM."""
    result=run(['nvidia-smi','-i',cfg['gpuUuid'],'--query-gpu=uuid,name,memory.free',
                '--format=csv,noheader,nounits'],capture_output=True,text=True,timeout=5,
               creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),check=True)
    fields=[x.strip() for x in result.stdout.strip().split(',')]
    if len(fields)!=3 or fields[0]!=cfg['gpuUuid'] or fields[1]!='NVIDIA GeForce RTX 3080 Ti':
        raise ValueError('The configured GPU does not match RTX 3080 Ti')
    free=int(fields[2])
    if free<0:raise ValueError('Invalid GPU memory reading')
    return free


def guarded_login(command, guard, timeout=140):
    """Keep resource/maintenance guards active while the private auth helper waits."""
    helper = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                              creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    deadline = time.monotonic() + timeout
    try:
        while helper.poll() is None:
            problem = guard()
            if problem:
                raise RuntimeError(problem)
            if time.monotonic() >= deadline:
                raise RuntimeError('CAMERA_AUTHENTICATION_TIMEOUT')
            time.sleep(.5)
        return helper.returncode
    finally:
        if helper.poll() is None:
            helper.terminate()
            try: helper.wait(timeout=3)
            except subprocess.TimeoutExpired:
                helper.kill()
                helper.wait(timeout=3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    cfg = configuration(args.config)
    if args.check:
        print(json.dumps({'passed': True, 'productionChanged': False}))
        return
    root = Path(cfg['stateDir'])
    root.mkdir(parents=True, exist_ok=True)
    game = Path(cfg['gameDir'])
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    user = ctypes.WinDLL('user32', use_last_error=True)
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
    kernel.CreateMutexW.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.ReleaseMutex.argtypes = [wintypes.HANDLE]
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD,
                                                wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.FILETIME), ctypes.POINTER(wintypes.FILETIME), ctypes.POINTER(wintypes.FILETIME), ctypes.POINTER(wintypes.FILETIME)]
    kernel.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    # A kernel mutex survives neither a normal exit nor a crash. It prevents two
    # live supervisors without leaving an unrecoverable stale file lock.
    identity = hashlib.sha256(str(root.resolve()).casefold().encode()).hexdigest()[:24]
    mutex = kernel.CreateMutexW(None, False, 'Local\\QiandengjiNativeCamera-' + identity)
    if not mutex or kernel.WaitForSingleObject(mutex, 0) not in (0, 0x80):
        if mutex:
            kernel.CloseHandle(mutex)
        raise RuntimeError('Another native camera supervisor owns this profile')
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    handle = None
    pid = None
    launches = []
    samples = []
    status = {'schema': 1, 'supervisorPid': os.getpid(), 'startedAt': datetime.datetime.now().astimezone().isoformat(),
              'phase': 'starting', 'restarts': 0, 'shadersEnabled': cfg['shadersEnabled'],
              'expectedGpu': cfg.get('expectedGpu','intel')}

    def save(phase):
        status.update(phase=phase, observedAt=datetime.datetime.now().astimezone().isoformat(), pid=pid)
        temporary = root / 'status.writing'
        temporary.write_text(json.dumps(status), encoding='utf-8')
        for attempt in range(6):
            try:
                os.replace(temporary, root / 'status.json')
                break
            except PermissionError:
                if attempt == 5:
                    raise
                time.sleep(.02)

    def creation_time(process):
        created, exited, system, used = [wintypes.FILETIME() for _ in range(4)]
        if not kernel.GetProcessTimes(process, ctypes.byref(created), ctypes.byref(exited), ctypes.byref(system), ctypes.byref(used)):
            raise RuntimeError('Cannot verify the owned renderer creation time')
        return (created.dwHighDateTime << 32) | created.dwLowDateTime

    def adopt(target, allow_exited=False):
        process = kernel.OpenProcess(0x0001 | 0x0010 | 0x0400 | 0x1000, False, target)
        if not process:
            if allow_exited and ctypes.get_last_error() == 87:
                return None
            raise RuntimeError('Cannot inspect own renderer process')
        buffer = ctypes.create_unicode_buffer(32768)
        size = wintypes.DWORD(len(buffer))
        if not kernel.QueryFullProcessImageNameW(process, 0, buffer, ctypes.byref(size)) or Path(buffer.value).resolve() != Path(cfg['java']).resolve():
            kernel.CloseHandle(process)
            raise RuntimeError('Renderer executable differs from the reviewed camera runtime')
        return process

    def alive():
        code = wintypes.DWORD()
        return bool(handle and kernel.GetExitCodeProcess(handle, ctypes.byref(code)) and code.value == 259)

    def close(grace=20):
        nonlocal handle, pid
        if not handle:
            return
        if not alive():
            kernel.CloseHandle(handle)
            handle = None
            pid = None
            return
        def window(hwnd, unused):
            owner = wintypes.DWORD()
            user.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
            if owner.value == pid:
                user.PostMessageW(hwnd, 0x0010, 0, 0)
            return True
        user.EnumWindows(callback_type(window), 0)
        limit = time.monotonic() + grace
        while alive() and time.monotonic() < limit:
            time.sleep(.2)
        if alive():
            # The open handle identifies this exact owned renderer, not a reused PID.
            if not kernel.TerminateProcess(handle, 124):
                raise RuntimeError('Owned renderer did not stop')
        kernel.CloseHandle(handle)
        handle = None
        pid = None
        (root / 'process.json').unlink(missing_ok=True)

    class Memory(ctypes.Structure):
        _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in ['PeakWorkingSetSize', 'WorkingSetSize',
            'QuotaPeakPagedPoolUsage', 'QuotaPagedPoolUsage', 'QuotaPeakNonPagedPoolUsage',
            'QuotaNonPagedPoolUsage', 'PagefileUsage', 'PeakPagefileUsage', 'PrivateUsage']]
    psapi = ctypes.WinDLL('psapi')
    psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Memory), wintypes.DWORD]

    def resource_problem():
        if Path(cfg['pauseFile']).exists() or (root / 'service.stop').exists():
            return 'CAMERA_MAINTENANCE_REQUESTED'
        if cfg.get('expectedGpu')=='rtx3080ti':
            try: free=gpu_free_mib(cfg)
            except (OSError,ValueError,subprocess.SubprocessError): free=-1
            status['gpuFreeMiB']=free
            if free<768: return 'CAMERA_GPU_MEMORY_BUDGET'
        memory=Memory()
        memory.cb=ctypes.sizeof(memory)
        if not psapi.GetProcessMemoryInfo(handle,ctypes.byref(memory),memory.cb):
            return 'CAMERA_MEMORY_UNAVAILABLE'
        status['privateGiB']=round(memory.PrivateUsage/2**30,3)
        if memory.PrivateUsage>cfg['maximumPrivateGiB']*2**30:
            return 'CAMERA_MEMORY_BUDGET'
        return None

    try:
        existing = root / 'process.json'
        if existing.exists():
            prior = json.loads(existing.read_text())
            if Path(prior.get('gameDir', '')).resolve() != game.resolve() or prior.get('server') != cfg['server']:
                raise RuntimeError('The existing renderer record belongs to another profile')
            try:
                telemetry = json.loads((game / 'diagnostics/qiandeng-native-camera.json').read_text())
            except (OSError, ValueError):
                telemetry = {}
            fresh = telemetry.get('pid') == prior.get('pid') and abs(time.time() - datetime.datetime.fromisoformat(telemetry.get('at','1970-01-01T00:00:00Z').replace('Z', '+00:00')).timestamp()) < 5
            pid = prior['pid']
            handle = adopt(pid, allow_exited=True)
            if handle is None:
                pid = None
                existing.unlink()
            elif fresh or prior.get('processCreationTime'):
                actual_creation = creation_time(handle)
                if prior.get('processCreationTime') and prior['processCreationTime'] != actual_creation:
                    kernel.CloseHandle(handle)
                    handle = None
                    raise RuntimeError('The prior renderer PID belongs to another process; inspect before launch')
                prior['processCreationTime'] = actual_creation
                existing.write_text(json.dumps(prior), encoding='utf-8')
                status['adoptedOriginalRenderer'] = True
            else:
                # A stale endpoint is not evidence that its renderer exited.
                # Never launch a duplicate while that ownership is unknown.
                kernel.CloseHandle(handle)
                handle = None
                raise RuntimeError('Original renderer record is stale; inspect before another launch')
        unhealthy_since = None
        while not (root / 'service.stop').exists():
            if Path(cfg['pauseFile']).exists():
                close()
                save('maintenance-paused')
                time.sleep(2)
                continue
            if not alive():
                close()
                launches = [at for at in launches if time.monotonic() - at < 600]
                if len(launches) >= 3:
                    save('restart-backoff')
                    time.sleep(5)
                    continue
                try:
                    heartbeat = json.loads(Path(cfg['authHeartbeat']).read_text())
                    if heartbeat.get('ready') is not True or abs(time.time() * 1000 - heartbeat['at']) > 5000:
                        raise ValueError('Game authentication not ready')
                except (OSError, ValueError, KeyError):
                    save('waiting-game')
                    time.sleep(5)
                    continue
                if cfg.get('expectedGpu')=='rtx3080ti':
                    try:free=gpu_free_mib(cfg)
                    except (OSError,ValueError,subprocess.SubprocessError):free=-1
                    status['gpuFreeMiB']=free
                    if free<1536:
                        save('waiting-gpu-memory')
                        time.sleep(10)
                        continue
                env = dict(os.environ)
                if cfg.get('expectedGpu','intel')=='intel':
                    env.update(GALLIUM_DRIVER='d3d12',MESA_D3D12_DEFAULT_ADAPTER_NAME='Intel',
                               MESA_SHADER_CACHE_DIR=str(game/'shader-cache'),MESA_SHADER_CACHE_MAX_SIZE='256M')
                launched = subprocess.run([cfg['python'], '-X', 'utf8', cfg['launcher'], '--game', str(game),
                                          '--java', cfg['java'], '--server', cfg['server']], env=env,
                                         capture_output=True, text=True, encoding='utf-8', check=True)
                pid = json.loads(launched.stdout)['pid']
                handle = adopt(pid)
                launches.append(time.monotonic())
                status['restarts'] += 1
                (root / 'process.json').write_text(json.dumps({'pid': pid, 'processCreationTime': creation_time(handle),
                                                              'gameDir': str(game), 'server': cfg['server']}))
                save('authenticating')
                # The helper reads credentials privately and verifies LoginGuard's
                # actual session receipt; it never prints the submitted password.
                try:
                    result=guarded_login([cfg['node'],cfg['loginHelper']],resource_problem)
                    problem='CAMERA_AUTHENTICATION_UNCONFIRMED' if result else None
                except RuntimeError as failure:
                    problem=str(failure)
                if problem:
                    status['lastError'] = problem
                    close(grace=2 if problem.startswith('CAMERA_GPU_') or problem.startswith('CAMERA_MEMORY_') else 20)
                    save('retry-wait')
                    time.sleep(20)
                    continue
                unhealthy_since = None
            problem=resource_problem()
            if problem:
                status['lastError']=problem
                close(grace=2)
                save('resource-budget-backoff')
                time.sleep(10)
                continue
            try:
                state = json.loads((game / 'diagnostics/qiandeng-native-camera.json').read_text())
                age = time.time() - datetime.datetime.fromisoformat(state['at'].replace('Z', '+00:00')).timestamp()
                healthy = (state['pid'] == pid and age < 5 and state.get('connected')
                           and state.get('server') == cfg['server'] and state.get('playerUuid') == cfg['expectedUuid']
                           and renderer_matches(state,cfg)
                           and state.get('cleanHud') is True)
                status.update(fps=state.get('fps'), frameBudget=state.get('frameBudget'), renderer=state.get('renderer'), cleanHud=state.get('cleanHud'),
                              modelCatalogueSize=state.get('modelCatalogueSize'))
                if not healthy:
                    raise ValueError('Unhealthy dedicated camera')
                unhealthy_since = None
                status.pop('lastError', None)
                samples.append({'at': state['at'], 'privateGiB': status.get('privateGiB'), 'fps': state.get('fps')})
                status['recentSamples'] = samples[-120:]
                samples = samples[-120:]
                save('ready')
            except (OSError, ValueError, KeyError):
                unhealthy_since = unhealthy_since or time.monotonic()
                save('waiting-renderer')
                if time.monotonic() - unhealthy_since > 20:
                    close()
                    unhealthy_since = None
            time.sleep(1 if cfg.get('expectedGpu')=='rtx3080ti' else 5)
    finally:
        close()
        save('stopped')
        kernel.ReleaseMutex(mutex)
        kernel.CloseHandle(mutex)


if __name__ == '__main__':
    main()
