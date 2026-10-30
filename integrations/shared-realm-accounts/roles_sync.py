"""Outbound ownership feed. HTTPS only, bounded roles, encrypted local IPC.

No credential hashes or game passwords are fetched; website ownership is not
inferred from a same-name character. Expired data never gets a new timestamp.
"""
import argparse,base64,ctypes,email.utils,hashlib,json,os,signal,time,urllib.request,uuid
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ENDPOINT='https://mc.kangqiang.site/api/v1/internal/realm-accounts/roles'
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise RuntimeError('OWNERSHIP_REDIRECT_REJECTED')

def local_clock(body,http_date,received_at,round_trip_ms):
    """Conservatively map the authenticated origin clock to the local IPC clock.

    HTTP Date has one-second precision. Count its upper bound plus the entire
    round trip as age; this shortens, rather than extends, the source lease.
    Original source timestamps remain available for audit. No stale renewal.
    """
    if not http_date or not 0<=round_trip_ms<=15000:raise ValueError('SOURCE_CLOCK_UNAVAILABLE')
    upper=int(email.utils.parsedate_to_datetime(http_date).timestamp()*1000)+1000
    observed,expires=body['observedAt'],body['expiresAt']
    if not isinstance(observed,int) or not isinstance(expires,int) or not 0<expires-observed<=60000 or observed>upper:raise ValueError('SOURCE_CLOCK_INVALID')
    age=upper-observed+round_trip_ms
    if age>=expires-observed:raise ValueError('SOURCE_LEASE_EXPIRED')
    return {**body,'sourceObservedAt':observed,'sourceExpiresAt':expires,'observedAt':received_at-age,
            'expiresAt':received_at-age+expires-observed,'clockMapping':'https-date-upper-bound-plus-round-trip'}

def publish(config):
    assert config['endpoint']==ENDPOINT and config['realmId']=='sao'
    token=Path(config['tokenFile']).read_text(encoding='utf-8').strip()
    import re
    assert re.fullmatch(r'sra_[A-Za-z0-9_-]{43}',token)
    request=urllib.request.Request(ENDPOINT,headers={'Authorization':'Bearer '+token,'Accept':'application/json','User-Agent':'MyAgentWorld-SharedAccounts/0.1.0'})
    started=time.monotonic()
    with urllib.request.build_opener(NoRedirect).open(request,timeout=12) as response:
        raw=response.read(65537);assert len(raw)<=65536;http_date=response.headers.get('Date')
    now=int(time.time()*1000);body=local_clock(json.loads(raw),http_date,now,int((time.monotonic()-started)*1000))
    assert body['schemaVersion']==1 and body['realmId']=='sao'
    assert now-15000<=body['observedAt']<=now+1000 and now<body['expiresAt']<=body['observedAt']+60000
    assert isinstance(body['roles'],list) and len(body['roles'])<=256
    names=set();ids=set()
    for row in body['roles']:
        assert set(row)=={'name','uuid'} and re.fullmatch(r'\.?[A-Za-z0-9_]{1,16}',row['name'])
        assert str(uuid.UUID(row['uuid']))==row['uuid'] and row['uuid'] not in ids and row['name'].lower() not in names
        names.add(row['name'].lower());ids.add(row['uuid'])
    key=bytes.fromhex(Path(config['keyFile']).read_text(encoding='utf-8').strip());assert len(key)==32
    iv=os.urandom(12);payload=json.dumps(body,separators=(',',':'),ensure_ascii=False).encode();encrypted=AESGCM(key).encrypt(iv,payload,b'maw:shared-accounts:1:sao:roles')
    envelope={'schemaVersion':1,'iv':base64.b64encode(iv).decode(),'data':base64.b64encode(encrypted).decode()}
    root=Path(config['directory']);assert root.is_absolute();root.mkdir(parents=True,exist_ok=True)
    tmp=root/('roles.'+str(uuid.uuid4())+'.tmp')
    try:
        with tmp.open('x',encoding='utf-8') as out:
            json.dump(envelope,out);out.flush();os.fsync(out.fileno())
        os.replace(tmp,root/'roles.json')
    finally:tmp.unlink(missing_ok=True)
    return {'ready':True,'roleCount':len(body['roles']),'observedAt':body['observedAt'],'expiresAt':body['expiresAt']}

def main():
    p=argparse.ArgumentParser();p.add_argument('--config',type=Path,required=True);p.add_argument('--once',action='store_true');p.add_argument('--stop',action='store_true');a=p.parse_args()
    config=json.loads(a.config.read_text(encoding='utf-8'));state=Path(config['directory'])/'feed-worker.json';stop=state.with_suffix('.stop')
    if a.stop:
        stop.write_text(json.dumps({'requestId':str(uuid.uuid4()),'at':time.time()}),encoding='utf-8');print('Stop requested; check worker terminal state');return
    handle=None
    if os.name=='nt' and not a.once:
        kernel=ctypes.WinDLL('kernel32',use_last_error=True);kernel.CreateMutexW.argtypes=[ctypes.c_void_p,ctypes.c_bool,ctypes.c_wchar_p];kernel.CreateMutexW.restype=ctypes.c_void_p
        handle=kernel.CreateMutexW(None,False,'Local\\MAW.SharedAccounts.'+hashlib.sha256(str(a.config.resolve()).lower().encode()).hexdigest()[:24])
        if not handle or ctypes.get_last_error()==183:raise SystemExit('Ownership feed worker already running or unavailable')
    started=time.time();running=True
    def end(*_):
        nonlocal running
        running=False
    signal.signal(signal.SIGINT,end);signal.signal(signal.SIGTERM,end)
    while running:
        try:report=publish(config)
        except Exception as error:report={'ready':False,'reason':type(error).__name__,'observedAt':int(time.time()*1000)}
        report.update(pid=os.getpid(),startedAt=started,phase='running');state.write_text(json.dumps(report),encoding='utf-8')
        if a.once:print(json.dumps(report));return
        for _ in range(150):
            if stop.exists():
                value=json.loads(stop.read_text(encoding='utf-8'));stop.unlink()
                if value.get('at',0)>=started:running=False;report.update(stopRequestId=value.get('requestId'));break
            if not running:break
            time.sleep(.1)
    report.update(phase='stopped',stoppedAt=time.time());state.write_text(json.dumps(report),encoding='utf-8')
    if handle:kernel.CloseHandle(handle)
if __name__=='__main__':main()
