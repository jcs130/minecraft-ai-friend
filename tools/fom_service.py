"""FOM entry point using the existing owned-child supervisor, watchdog and mailbox."""
from pathlib import Path
import argparse,hashlib,json,sys,time,tomllib
from maw_service import Supervisor,properties,read_json,submit,guard_console
from mixed_auth_support import verify,NAME as AUTH_NAME

PRODUCTION=Path('E:/MC/servers/fom-2.42/server').resolve()
RESEARCH=Path('E:/QiandengJiSocietyLab/research').resolve()
JIT='-XX:CompileCommand=exclude,net.caffeinemc.mods.lithium.common.shapes.VoxelShapeMatchesAnywhere::cuboidMatchesAnywhere'

def gateway_spec(raw,server,port,health,public,verify_hashes):
    gate=raw.get('agentGateway')
    if gate is None:return None,[]
    public_agents=gate.get('publicGameAccess',False)
    if type(public_agents)!=bool:raise ValueError('Agent gateway publicGameAccess must be an explicit boolean')
    if public_agents and not public:raise ValueError('Public Agent gateway requires selected public production mode')
    root=Path(gate['releaseDir']).resolve();gate_port=gate['port']
    if not root.is_relative_to(server.parent/'ops') or root==server.parent/'ops':raise ValueError('Gateway release must stay in this deployment ops directory')
    if type(gate_port)!=int or gate_port in (port,health) or (public and gate_port!=28977) or (not public and not 39000<=gate_port<=39999):raise ValueError('Invalid FOM Agent gateway port')
    manifest=root/'release.json';release=read_json(manifest,2*1024*1024)
    if release.get('schemaVersion')!=1 or release.get('minecraft')!='1.21.1' or release.get('modFiles')!=read_json(Path(raw['modsManifest']),65536)['files']:
        raise ValueError('Gateway release does not match this exact FOM mod set')
    files=release['files'];stats=[]
    required={'node.exe','gate/gate.cjs','registry/idmap.json','registry/items.json','registry/network-channels.json','registry/components.tsv','registry/particles.tsv','registry/entity-data-serializers.tsv'}
    if not required.issubset(files):raise ValueError('Incomplete Agent gateway release')
    for relative,digest in files.items():
        path=(root/relative).resolve()
        if not path.is_relative_to(root) or not path.is_file():raise ValueError('Invalid gateway release file')
        if verify_hashes and hashlib.sha256(path.read_bytes()).hexdigest()!=digest:raise ValueError('Gateway release hash differs')
        stat=path.stat();stats.append((str(path),stat.st_size,stat.st_mtime_ns))
    stat=manifest.stat();stats.append((str(manifest),stat.st_size,stat.st_mtime_ns))
    host='0.0.0.0' if public else '127.0.0.1'
    env={'NODE_PATH':str(root/'node_modules'),'GATE_LISTEN_HOST':host,'GATE_PUBLIC_GAME_ACCESS':'1' if public_agents else '0',
        'GATE_LAN_SUBNET':'192.168.3.0/24','GATE_AGENT_PREFIX':'ag_',
        'GATE_PREFIX_MSG':'此入口供 ag_ 开头的 Agent 使用；完整模组 Java 客户端请连接 28976。',
        'GATE_VANILLA':'0','GATE_VANILLA_PROJECTION':'1','GATE_REMAP':'1','GATE_SKIP_MOD_RECIPES':'1','GATE_NEOFORGE_TIME_BRIDGE':'1',
        'GATE_CACHE_FILE':str(Path(raw['runtimeDir'])/'gateway-cache.json')}
    for key,name in {'GATE_CHANNELS_FILE':'network-channels.json','GATE_COMPONENTS_FILE':'components.tsv','GATE_PARTICLES_FILE':'particles.tsv',
        'GATE_ENTITY_SERIALIZERS_FILE':'entity-data-serializers.tsv','GATE_IDMAP_FILE':'idmap.json','GATE_BEDROCK_ITEMS_FILE':'items.json'}.items():env[key]=str(root/'registry'/name)
    native=release.get('nativeViewer')
    if release.get('modFiles',{}).get('FarmersDelight-1.21.1-1.3.4.jar')=='139ad7696462c89c03eea463f805abffa552526c5dadaadae221dd9624cb197c':
        env['GATE_BRIDGE_COOKING_POT_GUI']='1'
    if native is not None:
        needed={'registry/'+n for n in ('block-states.jsonl','blocks.tsv','items.tsv','entities.tsv')}
        if not isinstance(native,dict) or native.get('schemaVersion')!=1 or native.get('channel')!='mcviewer:native_packet' or not needed.issubset(files) or native.get('registrySha256')!=files['registry/block-states.jsonl'] or native['registrySha256']!=release.get('nativeExport',{}).get('block-states.jsonl'):
            raise ValueError('Native Agent view does not match the frozen registry')
        env.update(GATE_NATIVE_VIEWER='1',GATE_NATIVE_STATES_FILE=str(root/'registry/block-states.jsonl'))
    return {'id':'gate','port':gate_port,'host':'127.0.0.1','listenHost':host,'command':[str(root/'node.exe'),str(root/'gate/gate.cjs'),str(gate_port),'127.0.0.1',str(port)],
        'cwd':str(root),'env':env,'dependsOn':['java'],'readiness':'minecraft','healthUrl':None,'stopMode':'stdin','stopText':'{"kind":"shutdown"}','startupTimeoutSeconds':30},stats

def check_server(server,port,host):
    values=properties(server/'server.properties')
    expected={'server-ip':host,'server-port':str(port),'online-mode':'false','enforce-secure-profile':'false','enable-rcon':'false','enable-query':'false','level-name':'world'}
    if any(values.get(k)!=v for k,v in expected.items()) or properties(server/'eula.txt').get('eula')!='true':
        raise ValueError('FOM server bind, mixed-login, world or local management properties differ')

def check_policies(server):
    from fom_smart_npc import check_policy
    check_policy(server)
    common=tomllib.loads((server/'config/sable-common.toml').read_text('utf-8'))
    if common.get('attempt_udp_networking') is not False or common.get('disable_udp_pipeline') is not True:raise ValueError('This FOM release uses explicit TCP physics synchronization')
    auth=tomllib.loads((server/'world/serverconfig/mixauth-server.toml').read_text('utf-8'))
    policy=auth['offline_login']
    if policy['trusted_login_window_hours']!=0 or policy['min_password_length']<8 or policy['bcrypt_cost']<12:raise ValueError('Mixed-login policy differs')

def load_config(file,*,verify_hashes=True):
    file=Path(file).resolve();raw=read_json(file)
    server=Path(raw['serverDir']).resolve();port=raw['gamePort'];health=raw['healthPort'];public=raw.get('publicGameAccess',False)
    if raw.get('schemaVersion')!=1 or type(public)!=bool or type(port)!=int or type(health)!=int or port==health or not 1024<=port<=65535 or not 1024<=health<=65535:
        raise ValueError('Invalid explicit FOM endpoint configuration')
    if public:
        if server!=PRODUCTION or (port,health)!=(28976,28985):raise ValueError('Public FOM uses the explicitly selected production server/ports')
    elif not server.is_relative_to(RESEARCH) or not 39000<=port<=39999 or not 39000<=health<=39999:
        raise ValueError('Research FOM remains on explicit loopback research ports')
    host='0.0.0.0' if public else '127.0.0.1'
    check_server(server,port,host)
    java=Path(raw['java']).resolve()
    if not java.is_file() or java.name.lower()!='java.exe' or not 1024<=raw.get('maxMemoryMiB',0)<=16384:raise ValueError('Explicit Java 21 and heap required')
    runtime=Path(raw['runtimeDir']).resolve()
    if not runtime.is_relative_to(server.parent) or runtime==server:raise ValueError('FOM runtime must stay in its own deployment')
    lockfile=Path(raw['modsManifest']).resolve();lock=read_json(lockfile,65536)
    actual={p.name:p for p in (server/'mods').glob('*.jar')}
    if set(actual)!=set(lock['files']):raise ValueError('FOM mod set differs from its release manifest')
    if verify_hashes and any(hashlib.sha256(actual[name].read_bytes()).hexdigest()!=digest for name,digest in lock['files'].items()):raise ValueError('FOM mod hash differs')
    verify(server/'mods'/AUTH_NAME)
    support=raw.get('supportJar','maw-fom-support-0.1.0.jar')
    if support not in ('maw-fom-support-0.1.0.jar','maw-fom-support-0.2.0.jar') or support not in actual:raise ValueError('Explicit first-join login policy adapter required')
    if [name for name in actual if name.startswith('maw-fom-support-')]!=[support]:raise ValueError('Duplicate or unselected FOM support adapter')
    check_policies(server)
    command=[str(java),'-Djava.net.preferIPv4Stack=true',JIT,'-Xms512M','-Xmx'+str(raw['maxMemoryMiB'])+'M','-Dfile.encoding=UTF-8','-Dstdout.encoding=UTF-8','-Dstderr.encoding=UTF-8','@java.args','nogui']
    spec={'id':'java','port':port,'host':'127.0.0.1','listenHost':host,'command':command,'cwd':str(server),'env':{},'dependsOn':[],'readiness':'minecraft','healthUrl':None,'stopMode':'stdin','stopText':'stop','startupTimeoutSeconds':300}
    if raw.get('agentGateway') is not None and support!='maw-fom-support-0.2.0.jar':raise ValueError('Agent gateway requires explicitly selected FOM support 0.2.0')
    gate,gate_stats=gateway_spec(raw,server,port,health,public,verify_hashes)
    return {'schemaVersion':1,'serverDir':str(server),'gamePort':port,'healthPort':health,'runtimeDir':str(runtime),'services':[spec]+([gate] if gate else []),
        'networkExposure':{'mode':'lan' if public else 'loopback','listenHost':host,'address':'192.168.3.163' if public else None,'publicGameAccess':public,
            'agentGatewayPublicGameAccess':bool(raw.get('agentGateway',{}).get('publicGameAccess',False))},
        '_file':str(file),'_raw':raw,'_lock':lock,'_gateStats':gate_stats,'_modStats':[(str(p),p.stat().st_size,p.stat().st_mtime_ns) for p in actual.values()]}

def validator(config):
    # Full hashes are checked on launch/resume; per-tick guards avoid rehashing hundreds of MiB.
    if read_json(Path(config['_file']))!=config['_raw']:raise ValueError('FOM configuration changed; review and restart owner')
    server=Path(config['serverDir']);check_server(server,config['gamePort'],config['services'][0]['listenHost'])
    check_policies(server)
    if read_json(Path(config['_raw']['modsManifest']),65536)!=config['_lock']:raise ValueError('FOM release manifest changed while running')
    current=sorted((str(p),p.stat().st_size,p.stat().st_mtime_ns) for p in (server/'mods').glob('*.jar'))
    if current!=sorted(config['_modStats']):raise ValueError('FOM mods changed while running')
    for path,size,stamp in config.get('_gateStats',[]):
        stat=Path(path).stat()
        if (stat.st_size,stat.st_mtime_ns)!=(size,stamp):raise ValueError('FOM Agent gateway release changed while running')

def main():
    if sys.stdout is not None:sys.stdout.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('plan','run','status','pause','resume','stop','shutdown','console'))
    parser.add_argument('--config',type=Path,required=True);parser.add_argument('--reason',default='local FOM maintenance')
    parser.add_argument('--command');parser.add_argument('--request-id');parser.add_argument('--wait',type=float,default=15)
    a=parser.parse_args();config=load_config(a.config)
    if a.action=='plan':
        print(json.dumps({k:config[k] for k in ('schemaVersion','serverDir','gamePort','healthPort','runtimeDir','services','networkExposure')}))
    elif a.action=='run':Supervisor(config,validator=lambda:validator(config)).run()
    elif a.action=='status':
        state=read_json(Path(config['runtimeDir'])/'health.json');state['heartbeatFresh']=0<=time.time()-state.get('heartbeatEpoch',0)<15
        if not state['heartbeatFresh']:state['healthy']=False
        print(json.dumps(state,ensure_ascii=False))
    else:
        request={'action':a.action}
        if a.action in ('pause','stop','shutdown'):request['reason']=a.reason
        if a.action=='console':request['command']=guard_console(a.command)
        if a.request_id:request['requestId']=a.request_id
        print(json.dumps(submit(config,request,max(1,min(a.wait,120))),ensure_ascii=False))

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'ok':False,'reason':type(error).__name__+': '+str(error)},ensure_ascii=False));sys.exit(1)
