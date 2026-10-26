"""Owned Tau Ceti service. Reuses the deployed watchdog, stdin and request ledger."""
from pathlib import Path
import argparse, hashlib, json, sys, time, tomllib, re, http.client
import maw_service
from maw_service import Supervisor, properties, read_json, submit, guard_console
maw_service.CONSOLE_COMMANDS=maw_service.CONSOLE_COMMANDS|{'maw_registry','tower'}

PRODUCTION=Path('E:/MC/servers/tau-ceti-1.3.3/server').resolve()
STAGING=Path('E:/MC/research/tau-replacement-20261026/server').resolve()
SUPPORT='maw-fom-support-0.2.0-tau234.jar'
REQUIRED={'online-mode':'false','enforce-secure-profile':'false','enable-rcon':'false','enable-query':'false','level-name':'world'}
def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def gateway(raw,server,manifest,public,verify):
    selected=raw.get('agentGateway')
    if selected is None:return None,[]
    port=28977 if public else 39477
    if selected.get('port')!=port or selected.get('publicGameAccess') is not public:raise ValueError('Explicit matching Agent gateway exposure required')
    root=Path(selected['releaseDir']).resolve()
    if not root.is_relative_to(server.parent/'ops') or root==server.parent/'ops':raise ValueError('Gateway release must belong to this deployment ops')
    release=read_json(root/'release.json',2*1024*1024)
    if release.get('schemaVersion')!=1 or release.get('minecraft')!='1.21.1' or release.get('modFiles')!=manifest['files']:raise ValueError('Gateway and server exact mod sets differ')
    files=release['files'];required={'node.exe','gate/gate.cjs','gate/bounded-jsonl.cjs','registry/idmap.json','registry/items.json','registry/block-states.jsonl','registry/network-channels.json','registry/components.tsv','registry/particles.tsv','registry/entity-data-serializers.tsv'}
    if not required.issubset(files):raise ValueError('Incomplete Tau gateway release')
    native=release.get('nativeViewer',{})
    if native.get('channel')!='mcviewer:native_packet' or native.get('registrySha256')!=files['registry/block-states.jsonl'] or native.get('registrySha256')!=release['nativeExport']['block-states.jsonl']:raise ValueError('Original packet view and registry differ')
    stats=[]
    for relative,expected in files.items():
        p=(root/relative).resolve()
        if not p.is_relative_to(root) or p.is_symlink() or not p.is_file():raise ValueError('Invalid release path')
        if verify and digest(p)!=expected:raise ValueError('Gateway artifact hash differs: '+relative)
        stats.append((str(p),p.stat().st_size,p.stat().st_mtime_ns))
    p=root/'release.json';stats.append((str(p),p.stat().st_size,p.stat().st_mtime_ns))
    host='0.0.0.0' if public else '127.0.0.1'
    env={'NODE_PATH':str(root/'node_modules'),'GATE_LISTEN_HOST':host,'GATE_PUBLIC_GAME_ACCESS':'1' if public else '0',
         'GATE_LAN_SUBNET':'192.168.3.0/24','GATE_AGENT_PREFIX':'ag_',
         'GATE_PREFIX_MSG':'Agent入口使用ag_名称；完整Tau客户端请连接28976。',
         'GATE_VANILLA':'0','GATE_VANILLA_PROJECTION':'1','GATE_REMAP':'1','GATE_SKIP_MOD_RECIPES':'1',
         'GATE_NEOFORGE_TIME_BRIDGE':'1','GATE_NATIVE_VIEWER':'1','GATE_NATIVE_STATES_FILE':str(root/'registry/block-states.jsonl'),
         'GATE_CACHE_FILE':str(Path(raw['runtimeDir'])/'gateway-cache.json')}
    for key,name in {'GATE_CHANNELS_FILE':'network-channels.json','GATE_COMPONENTS_FILE':'components.tsv','GATE_PARTICLES_FILE':'particles.tsv','GATE_ENTITY_SERIALIZERS_FILE':'entity-data-serializers.tsv','GATE_IDMAP_FILE':'idmap.json','GATE_BEDROCK_ITEMS_FILE':'items.json'}.items():env[key]=str(root/'registry'/name)
    return {'id':'gate','port':port,'host':'127.0.0.1','listenHost':host,'command':[str(root/'node.exe'),str(root/'gate/gate.cjs'),str(port),'127.0.0.1',str(raw['gamePort'])],
            'cwd':str(root),'env':env,'dependsOn':['java'],'readiness':'minecraft','healthUrl':None,'stopMode':'stdin','stopText':'{"kind":"shutdown"}','startupTimeoutSeconds':120},stats
def auth_policy(server):
    p=properties(server/'server.properties')
    if any(p.get(k)!=v for k,v in REQUIRED.items()):raise ValueError('Runtime authentication/world policy changed')
    auth=tomllib.loads((server/'world/serverconfig/mixauth-server.toml').read_text(encoding='utf-8-sig'))
    offline=auth['offline_login']
    if offline.get('trusted_login_window_hours')!=0 or not 8<=offline.get('min_password_length',0)<=72:raise ValueError('Password authentication policy changed')
    numen=read_json(server/'config/maw-numen-server.json')
    if numen.get('enabled') and (numen.get('bind')!='127.0.0.1' or numen.get('port')!=28989):raise ValueError('Numen endpoint must remain private on loopback')
    args=(server/'java.args').read_text(encoding='utf-8')
    if not re.search(r'--fml.neoForgeVersion\s+21\.1\.234(?:\s|$)',args):raise ValueError('Author-pinned NeoForge 21.1.234 required')
    return p
def load_config(path,verify=True):
    path=Path(path).resolve();raw=read_json(path,262144)
    server=Path(raw['serverDir']).resolve();public=raw.get('publicGameAccess')
    if type(public) is not bool or raw.get('schemaVersion')!=1:raise ValueError('Explicit schema and public mode required')
    if (server,raw.get('gamePort'),raw.get('healthPort')) != ((PRODUCTION,28976,28985) if public else (STAGING,39476,39485)):
        raise ValueError('Tau service only owns its exact authorized deployment/ports')
    host='0.0.0.0' if public else '127.0.0.1'
    p=auth_policy(server)
    if p.get('server-ip')!=host or p.get('server-port')!=str(raw['gamePort']) or properties(server/'eula.txt').get('eula')!='true':raise ValueError('Tau bind/authentication/world policy differs')
    java=Path(raw['java']).resolve();heap=raw.get('maxMemoryMiB')
    if not java.is_file() or java.name.lower()!='java.exe' or type(heap) is not int or not 4096<=heap<=16384:raise ValueError('Java/heap invalid')
    runtime=Path(raw['runtimeDir']).resolve()
    if not runtime.is_relative_to(server.parent/'ops'):raise ValueError('Runtime must stay in deployment ops')
    files={p.name:p for p in (server/'mods').glob('*.jar')};manifest=read_json(Path(raw['modsManifest']),262144)
    if set(files)!=set(manifest['files']):raise ValueError('Tau exact mod set differs')
    if verify:
        for name,p in files.items():
            with p.open('rb') as stream:
                if hashlib.file_digest(stream,'sha256').hexdigest()!=manifest['files'][name]:raise ValueError('Tau mod hash differs: '+name)
    if not {'mixauth-1.21.1-1.3.3.jar',SUPPORT}.issubset(files):raise ValueError('Mixed login and first-join adapter required')
    command=[str(java),'-Djava.net.preferIPv4Stack=true','-Xms2G','-Xmx'+str(heap)+'M','-Dfile.encoding=UTF-8','@java.args','nogui']
    spec={'id':'java','port':raw['gamePort'],'host':'127.0.0.1','listenHost':host,'command':command,'cwd':str(server),'env':{},'dependsOn':[],'readiness':'minecraft','healthUrl':None,'stopMode':'stdin','stopText':'stop','startupTimeoutSeconds':600,'numenPort':28989}
    gate,gate_stats=gateway(raw,server,manifest,public,verify)
    return {'schemaVersion':1,'serverDir':str(server),'gamePort':raw['gamePort'],'healthPort':raw['healthPort'],'runtimeDir':str(runtime),'services':[spec]+([gate] if gate else []),
      'networkExposure':{'mode':'public' if public else 'loopback','listenHost':host},'_file':str(path),'_raw':raw,'_lock':manifest,
      '_stats':[(str(p),p.stat().st_size,p.stat().st_mtime_ns) for p in files.values()],
      '_argsSha':hashlib.sha256((server/'java.args').read_bytes()).hexdigest(),'_gateStats':gate_stats}
def validate(config):
    if read_json(Path(config['_file']),262144)!=config['_raw']:raise ValueError('Configuration changed; reconcile and restart owner')
    raw=config['_raw'];server=Path(config['serverDir']);host=config['services'][0]['listenHost'];p=auth_policy(server)
    if p.get('server-ip')!=host or p.get('server-port')!=str(config['gamePort']):raise ValueError('Runtime bind changed')
    if hashlib.sha256((server/'java.args').read_bytes()).hexdigest()!=config['_argsSha']:raise ValueError('Java launch arguments changed')
    if read_json(Path(raw['modsManifest']),262144)!=config['_lock']:raise ValueError('Mod release changed')
    if sorted((str(p),p.stat().st_size,p.stat().st_mtime_ns) for p in (server/'mods').glob('*.jar'))!=sorted(config['_stats']):raise ValueError('Mods changed while running')
    for path,size,stamp in config['_gateStats']:
        stat=Path(path).stat()
        if (stat.st_size,stat.st_mtime_ns)!=(size,stamp):raise ValueError('Gateway release changed while running')
class TauChild(maw_service.Child):
    def tick(self):
        super().tick()
        port=self.spec.get('numenPort')
        if not self.ready or not port:return
        try:
            maw_service.check_owned_listener(port,self.process.pid,expected_host='127.0.0.1')
            connection=http.client.HTTPConnection('127.0.0.1',port,timeout=1.5)
            try:
                connection.request('GET','/healthz',headers={'Host':'127.0.0.1:'+str(port)})
                response=connection.getresponse();raw=response.read(8193)
                if response.status!=200 or len(raw)>8192:raise ValueError('Invalid private endpoint response')
                state=json.loads(raw)
                if state.get('ok') is not True or state.get('nativeModAccess') is not True or state.get('nativeModOperationCount',0)<35:raise ValueError('Native mod SDK not ready')
                self.metrics['numen']={k:state[k] for k in ('numenVersion','serverResident','clientRequired','nativeModAccess','nativeModOperationCount')}
            finally:connection.close()
        except Exception as error:
            self.ready=False;self.problem='private_numen_readiness_failed: '+str(error)
def main():
    if sys.stdout:sys.stdout.reconfigure(encoding='utf8')
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['plan','run','status','pause','resume','stop','shutdown','console']);p.add_argument('--config',required=True);p.add_argument('--command');p.add_argument('--request-id');p.add_argument('--reason',default='Tau operator maintenance');p.add_argument('--wait',type=float,default=30)
    a=p.parse_args();config=load_config(a.config,verify=a.action in ('run','plan','resume'))
    if a.action=='run':Supervisor(config,validator=lambda:validate(config),child_factory=TauChild).run()
    elif a.action=='plan':print(json.dumps({k:v for k,v in config.items() if not k.startswith('_')}))
    elif a.action=='status':
        state=read_json(Path(config['runtimeDir'])/'health.json');state['heartbeatFresh']=0<=time.time()-state.get('heartbeatEpoch',0)<15
        if not state['heartbeatFresh']:state['healthy']=False
        print(json.dumps(state))
    else:
        request={'action':a.action,'reason':a.reason}
        if a.action=='console':
            if a.command in ('maw_registry dumpids','maw_registry visuals','maw_registry metadata','tower floor'):
                request['command']=a.command
            else:request['command']=guard_console(a.command)
        if a.request_id:request['requestId']=a.request_id
        receipt=submit(config,request,min(120,max(1,a.wait)))
        print(json.dumps(receipt))
if __name__=='__main__':
    try:main()
    except Exception as e:print(json.dumps({'ok':False,'reason':str(e)}));sys.exit(1)
