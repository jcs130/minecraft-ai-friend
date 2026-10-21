"""An independently owned Geyser bridge for the frozen FOM release.

No world server, authentication database, Agent controller or old bridge is
started/adopted here. Bedrock uses a separate login-name namespace and FOM's
existing mixed-login policy. An offline QA bridge is loopback-only.
"""
from __future__ import annotations
from pathlib import Path
import argparse,hashlib,json,sys,time
import fom_service as fom
import maw_service as service
import maw_bedrock_service as original
import maw_bedrock_resources as resources
import maw_bedrock_modpacks as models
import fom_bedrock_block_contract as blocks

DEFAULT=Path('E:/MC/servers/fom-2.42/ops/fom-bedrock.json')
PORTS={'lan':(28988,28994,28995,28996),'offline_qa':(28993,28991,28992,28997)}
QA_ROOT=Path('E:/MC/staging').resolve()

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def geyser_config(mode):
    if mode not in PORTS:raise ValueError('Unknown Bedrock mode')
    text=original.geyser_config('192.168.3.163' if mode=='lan' else '127.0.0.1')
    text=text.replace('port: 28988','port: '+str(PORTS[mode][0])).replace('primary-motd: My Agent World','primary-motd: My Agent World FOM 2.42').replace('secondary-motd: NeoForge LAN visitor','secondary-motd: Java + Agent + Bedrock').replace('max-players: 4','max-players: 8')
    if mode=='offline_qa':text=text.replace('validate-bedrock-login: true','validate-bedrock-login: false')
    return text

def load_config(path,*,verify_hashes=True):
    raw=service.read_json(Path(path));mode=raw.get('mode')
    if raw.get('schemaVersion')!=1 or mode not in PORTS or set(raw)!={'schemaVersion','mode','mainConfig','bridgeDir','gatewayRelease'}:raise ValueError('Invalid FOM Bedrock configuration')
    main_path=Path(raw['mainConfig']).resolve();main=fom.load_config(main_path,verify_hashes=verify_hashes)
    upstream=Path(main['serverDir']).resolve()
    production=upstream==fom.PRODUCTION and main['gamePort']==28976
    # Only the explicitly loopback QA mode may exercise a private candidate.
    # fom.load_config still checks its root, bind, auth and exact release hashes.
    research=(upstream.is_relative_to(fom.RESEARCH) and 39000<=main['gamePort']<=39999
              and main['networkExposure']['publicGameAccess'] is False)
    if not production and not (mode=='offline_qa' and research):raise ValueError('FOM Bedrock must target the selected FOM world')
    directory=Path(raw['bridgeDir']).resolve()
    if mode=='lan':
        if directory.parent!=(fom.PRODUCTION.parent/'ops').resolve() or not directory.name.startswith('bedrock-'):raise ValueError('Production bridge must stay in FOM ops')
    else:
        if not directory.is_relative_to(QA_ROOT) or (directory/'.fom-bedrock-qa').read_text().strip()!='loopback-only':raise ValueError('Offline QA must stay in marked staging')
    udp,gate,tcp,health=PORTS[mode];address='192.168.3.163' if mode=='lan' else '127.0.0.1'
    expected={directory/name:digest for name,digest in original.ARTIFACTS.items()}
    expected[directory/'plugins/Geyser/config.yml']=hashlib.sha256(geyser_config(mode).encode()).hexdigest()
    release=Path(raw['gatewayRelease']).resolve();record=service.read_json(release/'release.json',2*1024*1024)
    mod_files=service.read_json(Path(main['_raw']['modsManifest']),65536)['files']
    if record.get('schemaVersion')!=1 or record.get('minecraft')!='1.21.1' or record.get('modFiles')!=mod_files:raise ValueError('Bedrock gateway must match the actual FOM mod set')
    if not {'gate/gate.cjs','gate/bedrock-account.cjs','registry/idmap.json'}.issubset(record['files']):raise ValueError('Incomplete namespaced FOM gateway')
    if mode=='lan' and not release.is_relative_to(fom.PRODUCTION.parent/'ops'):raise ValueError('Gateway release must be private deployed FOM files')
    for name,digest in record['files'].items():
        target=(release/name).resolve()
        if not target.is_relative_to(release):raise ValueError('Unsafe gateway artifact path')
        expected[target]=digest
    expected[release/'release.json']=sha(release/'release.json')
    expected[Path(path)]=sha(path);expected[main_path]=sha(main_path)
    catalog=directory/'plugins/Geyser'
    contract=resources.validate(catalog,deployed=True)
    if sha(release/'registry/idmap.json')!=contract['inputs']['idmapSha256']:raise ValueError('FOM resource pack uses a different registry')
    expected[catalog/resources.CONTRACT]=sha(catalog/resources.CONTRACT)
    for name,subdir in [(resources.PACK,'packs'),(resources.MAPPINGS,'custom_mappings'),(resources.CATALOG,'')]:expected[catalog/subdir/name]=contract['files'][name]['sha256']
    projection_path=catalog/'fom-projection-contract.json';projection=service.read_json(projection_path)
    if projection.get('schemaVersion')!=1 or projection.get('nativeCatalogSha256')!=sha(release/'registry/items.json') or projection.get('iconCatalogSha256')!=contract['files'][resources.CATALOG]['sha256']:raise ValueError('Native item labels belong to a different FOM release')
    expected[projection_path]=sha(projection_path);expected[catalog/'fom-item-projection.json']=projection['projectionSha256']
    model_contract=None;extensions=set()
    if (catalog/models.CONTRACT).is_file():
        model_contract=models.validate(catalog,deployed=True)
        definitions=service.read_json(catalog/models.CATALOG,16*1024*1024)
        maid=definitions.get('maidMetadata',{})
        if maid.get('jarSha256')!=models.TLM_SHA or models.TLM_SHA not in mod_files.values():raise ValueError('Maid model adapter belongs to another installed mod')
        if model_contract['geyserJarSha256']!=expected[directory/'plugins/Geyser-ViaProxy.jar']:raise ValueError('Maid extension uses another Geyser build')
        expected[catalog/models.CONTRACT]=sha(catalog/models.CONTRACT)
        for name,meta in model_contract['files'].items():
            expected[catalog/meta['directory']/name]=meta['sha256']
            if meta['directory']=='extensions':extensions.add(name)
        if extensions!={models.EXTENSION}:raise ValueError('Unreviewed model extensions')
    block_contract=None
    if (catalog/blocks.CONTRACT).is_file():
        block_contract=blocks.validate(catalog,deployed=True)
        if block_contract['geyserJarSha256']!=expected[directory/'plugins/Geyser-ViaProxy.jar']:raise ValueError('Block extension uses another Geyser build')
        if block_contract['inputs']['statesSha256']!=record['nativeExport']['block-states.jsonl']:raise ValueError('Block models belong to another native state registry')
        if 'gate/bedrock-blocks.cjs' not in record['files']:raise ValueError('Missing native block transport')
        if block_contract.get('blockItemCount',0):
            inputs=block_contract['blockItemInputs']
            if inputs['itemsSha256']!=contract['inputs']['registrySha256'] or inputs['idmapSha256']!=contract['inputs']['idmapSha256'] or inputs['projectionSha256']!=projection['projectionSha256']:raise ValueError('Block item icons belong to another native item registry')
        expected[catalog/blocks.CONTRACT]=sha(catalog/blocks.CONTRACT)
        for name,meta in block_contract['files'].items():
            expected[catalog/meta['directory']/name]=meta['sha256']
            if meta['directory']=='extensions':extensions.add(name)
    stamps={}
    for file,digest in expected.items():
        if not file.is_file() or file.is_symlink() or verify_hashes and sha(file)!=digest:raise ValueError('Bedrock release hash mismatch: '+file.name)
        stat=file.stat();stamps[file]=(stat.st_size,stat.st_mtime_ns)
    def validate():
        # Do not rehash a full dependency tree every second. The immutable
        # release is hashed once and file stamps plus native FOM policy recur.
        fom.validator(main)
        for file,before in stamps.items():
            stat=file.stat()
            if (stat.st_size,stat.st_mtime_ns)!=before:raise ValueError('Bedrock release changed: '+file.name)
        if {p.name for p in (directory/'plugins').glob('*.jar')}!={'Geyser-ViaProxy.jar'}:raise ValueError('Unreviewed proxy plugins')
        if {p.name for p in (catalog/'extensions').glob('*.jar')}!=extensions:raise ValueError('Unreviewed Geyser extensions')
    source=next(s for s in main['services'] if s['id']=='gate');env={**source['env']}
    env.update(NODE_PATH=str(release/'node_modules'),GATE_LISTEN_HOST='127.0.0.1',GATE_PUBLIC_GAME_ACCESS='0',GATE_AGENT_PREFIX='',
        GATE_BEDROCK_ACCOUNT_NAMESPACE='1',GATE_BEDROCK_PROJECTION='1',GATE_NATIVE_VIEWER='0',
        GATE_CACHE_FILE=str(directory/'knowledge.json'),GATE_BEDROCK_ITEMS_FILE=str(catalog/'fom-item-projection.json'))
    env.pop('GATE_LAN_SUBNET',None)
    env.pop('GATE_BEDROCK_MODELS_FILE',None)
    if model_contract:env['GATE_BEDROCK_MODELS_FILE']=str(catalog/models.CATALOG)
    env.pop('GATE_BEDROCK_BLOCKS_FILE',None)
    if block_contract:env['GATE_BEDROCK_BLOCKS_FILE']=str(catalog/blocks.CATALOG)
    for key,name in {'GATE_CHANNELS_FILE':'network-channels.json','GATE_COMPONENTS_FILE':'components.tsv','GATE_PARTICLES_FILE':'particles.tsv','GATE_ENTITY_SERIALIZERS_FILE':'entity-data-serializers.tsv','GATE_IDMAP_FILE':'idmap.json'}.items():env[key]=str(release/'registry'/name)
    heap='-Xmx2048M' if block_contract else '-Xmx512M'
    command=[str(service.DEFAULT_JAVA),'-Djava.net.preferIPv4Stack=true','-Xms128M',heap,'-jar',str(directory/'ViaProxy-3.4.14.jar'),'cli','--target-address','127.0.0.1:'+str(gate),'--target-version','1.21.1','--auth-method','NONE','--bind-address','127.0.0.1:'+str(tcp),'--wildcard-domain-handling','NONE']
    if block_contract and mode=='offline_qa':command.insert(1,'-Dmaw.nativeBlocks.trace=true')
    return {'serverDir':str(directory),'runtimeDir':str(directory/'ops'),'gamePort':tcp,'healthPort':health,'validator':validate,
        'fomRunConfig':str(main_path),'mode':mode,'udpPort':udp,'udpAddress':address,'resourceContract':contract,'modelContract':model_contract,'blockContract':block_contract,
        'networkExposure':{'mode':mode,'address':address,'udpPort':udp,'javaListenHost':'127.0.0.1'},
        'services':[{'id':'compat_gate','command':[str(release/'node.exe'),str(release/'gate/gate.cjs'),str(gate),'127.0.0.1',str(main['gamePort'])],'cwd':str(release),'env':env,'host':'127.0.0.1','listenHost':'127.0.0.1','port':gate,'dependsOn':[],'readiness':'minecraft','startupTimeoutSeconds':90,'stopMode':'stdin','stopText':'{"kind":"shutdown"}','fomHealthPort':main['healthPort'],'fomServerDir':str(upstream)},
            {'id':'bedrock','command':command,'cwd':str(directory),'env':{},'host':'127.0.0.1','listenHost':'127.0.0.1','port':tcp,'dependsOn':['compat_gate'],'readiness':'minecraft','startupTimeoutSeconds':90,'stopMode':'stdin','stopText':'stop'}]}

class BedrockChild(service.Child):
    def tick(self):
        super().tick()
        if self.ready and self.spec['id']=='compat_gate':
            try:
                from urllib.request import urlopen
                with urlopen('http://127.0.0.1:'+str(self.spec['fomHealthPort'])+'/healthz',timeout=1) as response:main=json.load(response)
                if not main['healthy'] or not 0<=time.time()-main['heartbeatEpoch']<15 or Path(main['serverDir']).resolve()!=Path(self.spec['fomServerDir']).resolve():raise ValueError('FOM world is not ready')
            except Exception as error:self.ready=False;self.problem='fom_upstream_unavailable: '+str(error)
        if self.ready and self.spec['id']=='bedrock':
            try:
                config=self.spec['bridgeConfig'];original.check_udp_owner(config['udpPort'],self.process.pid,config['udpAddress'])
                # The original decoder enforces the complete RakNet framing.
                import socket,struct
                stamp=time.time_ns()//1000000
                with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as sock:
                    sock.settimeout(1.5);sock.connect((config['udpAddress'],config['udpPort']))
                    sock.send(b'\x01'+struct.pack('>q',stamp)+original.MAGIC+struct.pack('>q',0x4d4157464f4d));data=sock.recv(4096)
                pong=original.decode_pong(data,stamp)
                if pong['motd']!='My Agent World FOM 2.42' or pong['port']!=config['udpPort'] or pong['maxPlayers']!=8:raise ValueError('Wrong FOM Bedrock endpoint')
                self.metrics['bedrock']=pong
                if 'customItems' not in self.metrics:self.metrics['customItems']=resources.registered_items(Path(self.handler.baseFilename),config['resourceContract'],time.time()-(time.monotonic()-self.started)-5,additional_definitions=(config.get('blockContract') or {}).get('blockItemCount',0))
                if config.get('modelContract') and 'customModels' not in self.metrics:self.metrics['customModels']=models.registered_models(Path(self.handler.baseFilename),config['modelContract'],time.time()-(time.monotonic()-self.started)-5)
                if config.get('blockContract') and 'customBlocks' not in self.metrics:self.metrics['customBlocks']=blocks.registered_blocks(Path(self.handler.baseFilename),config['blockContract'],time.time()-(time.monotonic()-self.started)-5)
            except Exception as error:
                self.ready=False;self.problem='fom_bedrock_readiness_failed: '+str(error)
                if time.monotonic()-self.started>self.spec['startupTimeoutSeconds']:self.stop()

class BedrockSupervisor(service.Supervisor):
    def apply(self,request):
        if request.get('action')=='console':raise ValueError('No bridge console API')
        return super().apply(request)

def main():
    if sys.stdout is not None:sys.stdout.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=('plan','run','status','pause','resume','shutdown'));parser.add_argument('--config',type=Path,default=DEFAULT)
    args=parser.parse_args();config=load_config(args.config)
    for row in config['services']:
        if row['id']=='bedrock':row['bridgeConfig']={k:config[k] for k in ('udpPort','udpAddress','resourceContract','modelContract','blockContract')}
    if args.action=='run':BedrockSupervisor(config,validator=config['validator'],child_factory=BedrockChild).run()
    elif args.action=='plan':print(json.dumps({**{k:config[k] for k in ('serverDir','runtimeDir','healthPort','mode','udpPort','udpAddress')},'services':[{'id':'bedrock','port':config['gamePort']}]},ensure_ascii=False))
    elif args.action=='status':
        state=service.read_json(Path(config['runtimeDir'])/'health.json');state['heartbeatFresh']=0<=time.time()-state.get('heartbeatEpoch',0)<15;state['healthy']=state.get('healthy') is True and state['heartbeatFresh'];print(json.dumps(state,ensure_ascii=False))
    else:print(json.dumps(service.submit(config,{'action':args.action}),ensure_ascii=False))

if __name__=='__main__':
    try:main()
    except Exception as error:print(json.dumps({'ok':False,'reason':type(error).__name__+': '+str(error)}));sys.exit(1)
