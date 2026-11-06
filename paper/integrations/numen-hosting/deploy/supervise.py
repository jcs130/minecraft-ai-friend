"""Supervise the dedicated hosting service, restricted reverse tunnel, or dedicated Hub startup."""
import ctypes
from ctypes import wintypes
import http.client,json,logging,msvcrt,os,subprocess,sys,threading,time
from logging.handlers import RotatingFileHandler
from pathlib import Path
BASE=Path(__file__).resolve().parents[2]
PRIVATE=BASE/'private'
RELEASE=BASE/'release-20261106-r1'
NODE=Path('C:/Users/lzl19/AppData/Local/hermes/node/node.exe')
SSH=Path('C:/Windows/System32/OpenSSH/ssh.exe')
WSL=Path('C:/Windows/System32/wsl.exe')
HUB_IMAGE='sha256:1e9fe5373b1aaaa8946d62b7ca241a3e8d4c1312b5beb603af5656f760036e10'

class BasicJobLimits(ctypes.Structure):
    _fields_ = [
        ("per_process_time", ctypes.c_longlong), ("per_job_time", ctypes.c_longlong),
        ("flags", wintypes.DWORD), ("min_working_set", ctypes.c_size_t),
        ("max_working_set", ctypes.c_size_t), ("active_processes", wintypes.DWORD),
        ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD),
    ]


class JobLimits(ctypes.Structure):
    _fields_ = [
        ("basic", BasicJobLimits), ("io", ctypes.c_ulonglong * 6),
        ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
        ("peak_process_memory", ctypes.c_size_t), ("peak_job_memory", ctypes.c_size_t),
    ]


def own_process_tree(child):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    limits = JobLimits()
    limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not kernel.AssignProcessToJobObject(job, int(child._handle)):
        error = ctypes.get_last_error()
        kernel.CloseHandle(job)
        raise ctypes.WinError(error)
    return lambda: kernel.CloseHandle(job)


def command(mode):
    if mode=='service':return [str(NODE),str(RELEASE/'integrations/numen-hosting/src/main.mjs'),'--adapter',str(RELEASE/'integrations/numen-hosting/assembly.mjs')]
    return [str(SSH),'-F',str(PRIVATE/'ssh_config'),'-NT','-i',str(PRIVATE/'tunnel-ed25519'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','IdentityAgent=none','-o','StrictHostKeyChecking=yes','-o','HostKeyAlgorithms=ssh-ed25519','-o','UserKnownHostsFile='+str(PRIVATE/'known_hosts'),'-o','GlobalKnownHostsFile=NUL','-o','ExitOnForwardFailure=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-R','127.0.0.1:19084:127.0.0.1:19084','qdhosted-reverse@47.242.3.87']

def healthy():
    c=http.client.HTTPConnection('127.0.0.1',19084,timeout=3)
    try:
        c.request('GET','/v1/hosting');r=c.getresponse();return r.status==401 and json.loads(r.read(1024)).get('error')=='UNAUTHORIZED'
    except Exception:return False
    finally:c.close()

def output(child,mode,log):
    for line in child.stdout:
        if mode=='service':
            try:
                row=json.loads(line);keys={'ready','host','port','automaticResume','component','type','code','roleUuid'}
                log.info('%s',json.dumps({k:v for k,v in row.items() if k in keys}));continue
            except Exception:log.info('Service diagnostic suppressed; inspect the verified assembly and exit status.');continue
        log.info('%s',line.rstrip()[:1000])

def ensure_hub():
    # Starting WSL starts its already-enabled Docker system service. Never stop
    # the shared daemon or restart any container that is already running.
    base=[str(WSL),'-d','Ubuntu-24.04','--','docker']
    result=subprocess.run([*base,'inspect','--format','{{.State.Running}} {{.Image}}','qiandengji-hosted-hub'],capture_output=True,text=True,timeout=45,creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:raise RuntimeError('Dedicated Hub metadata unavailable')
    running,image=result.stdout.strip().split()
    if image!=HUB_IMAGE:raise RuntimeError('Dedicated Hub image differs from reviewed release')
    if running=='false':
        subprocess.run([*base,'start','qiandengji-hosted-hub'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=45,creationflags=subprocess.CREATE_NO_WINDOW)
    elif running!='true':raise RuntimeError('Unknown dedicated Hub state')


def main():
    assert len(sys.argv)==2 and sys.argv[1] in ('service','tunnel','hub')
    mode=sys.argv[1]
    with (PRIVATE/(mode+'.lock')).open('a+b') as lock:
        if lock.tell()==0:lock.write(b'0');lock.flush()
        lock.seek(0);msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        log=logging.getLogger(mode);log.setLevel(logging.INFO)
        handler=RotatingFileHandler(PRIVATE/(mode+'.log'),maxBytes=2*1024*1024,backupCount=3,encoding='utf8')
        handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'));log.addHandler(handler)
        if mode=='hub':
            while True:
                try:ensure_hub()
                except Exception:log.warning('Dedicated Hub startup check failed; retry in 60 seconds')
                time.sleep(60)
        delay=5
        while True:
            env=dict(os.environ);env['QDJ_HOSTING_CONFIG']=str(PRIVATE/'hosting.json')
            child=subprocess.Popen(command(mode),cwd=RELEASE,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,encoding='utf8',errors='replace',creationflags=subprocess.CREATE_NO_WINDOW,env=env)
            try:close=own_process_tree(child)
            except OSError:child.terminate();child.wait();raise
            reader=threading.Thread(target=output,args=(child,mode,log),daemon=True);reader.start();began=time.monotonic();failures=0
            log.info('Started dedicated %s child PID %d',mode,child.pid)
            try:
                while child.poll() is None:
                    time.sleep(10)
                    if mode=='service' and time.monotonic()-began>90:
                        failures=0 if healthy() else failures+1
                        if failures>=3:log.warning('Dedicated hosting health failed three times');break
            finally:
                close();child.wait(timeout=15);reader.join(timeout=3);child.stdout.close()
            if time.monotonic()-began>120:delay=5
            log.warning('Dedicated %s exited %d; retry in %ds',mode,child.returncode,delay)
            time.sleep(delay);delay=min(60,delay*2)

if __name__=='__main__':main()
