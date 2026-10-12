"""Read-only installed Wandscape/gateway/resource health. Never creates a town or calls a model."""
from pathlib import Path
import argparse,hashlib,json,time,zipfile
from urllib.request import urlopen

REPO=Path(__file__).resolve().parents[1]
LOCK=REPO/'manifests/wandscape-1.21.1.lock.json'
OPERATIONS={f'wandscape.{s}' for s in ('state','catalog','found','build','recruit','strategy','deposit','withdraw')}
def read(path):return json.loads(path.read_bytes())
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def probe(root):
    checks={};out={'schemaVersion':1,'scope':'installed_bytes_and_service_health','checks':checks,'worldActions':0,'modelCalls':0,'ok':False,'actualPhoneTested':False,'completeRendererParityVerified':False}
    try:
        lock=read(LOCK);jar=root/'server/mods'/lock['name']
        checks['locked-official-mod']=jar.stat().st_size==lock['bytes'] and sha(jar)==lock['sha256']
        bridge=root/'server/mods/maw_agent_bridge-0.1.0.jar';build=read(root/'build/society-bridge/build-record.json')
        checks['compiled-installed-bridge']=sha(bridge)==build['sha256']
        with zipfile.ZipFile(bridge) as z:
            ops=json.loads(z.read('maw-native-operations.json'))
            checks['eight-native-operations']=OPERATIONS<={r['id'] for r in ops['operations']}
            checks['native-and-menu-classes']=all(f'dev/qiandeng/maw/{s}.class' in z.namelist() for s in ('WandscapeAccess','WandscapeMenus'))
        assets=Path(read(root/'services/agent.json')['assetDirectory']);manifest=read(assets/'native-assets.json')
        checks['exact-source-assets']=manifest['assetIntegrityVerified'] is True and any(s['sha256']==lock['sha256'] for s in manifest['sources'])
        checks['same-final-registry']=manifest['registryHashes']['block-states.jsonl']==sha(root/'gateway/permanent/registry/block-states.jsonl')
        resources=root/'bedrock/plugins/Geyser'
        from maw_bedrock_modpacks import validate
        validate(resources,deployed=True)
        catalog=read(resources/'modpack-catalog.json');wizards=[m for m in catalog['models'] if m['kind']=='wandscape']
        checks['21-wizard-original-textures']=len(wizards)==21 and all(m['sourceJarSha256']==lock['sha256'] for m in wizards)
        checks['typed-native-wizard-metadata']=catalog['wandscapeMetadata']['skinVariant']==16 and catalog['wandscapeMetadata']['hatColor']==17
        checks['pack-matches-export']=catalog['sourceManifestSha256']==sha(assets/'native-assets.json')
        gate=next(s for s in read(root/'services/service.json')['services'] if s['id']=='gate')
        checks['main-scene-channels']={'maw_agent:scene_state','maw_agent:scene_subscribe'}<=set(gate.get('env',{}).get('GATE_EXTRA_PLAY_CHANNELS','').split(','))
        for port,name in ((28985,'main'),(28996,'bedrock')):
            h=json.load(urlopen(f'http://127.0.0.1:{port}/healthz',timeout=5))
            checks[name+'-fresh-owned-service']=h['healthy'] is True and not h['paused'] and 0<=time.time()-h['heartbeatEpoch']<20
    except Exception as e:out['error']=str(e)[:300]
    out['ok']=len(checks)==12 and all(checks.values());return out
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('mode',choices=('plan','health'));p.add_argument('--root',type=Path,default=Path(r'E:\QiandengJiSocietyLab'));a=p.parse_args()
    r={'artifact':read(LOCK),'operations':sorted(OPERATIONS),'humanEntry':'/mycli town','requiresColdBackupAndRegistryResourceRefresh':True} if a.mode=='plan' else probe(a.root)
    print(json.dumps(r,ensure_ascii=False,indent=2));raise SystemExit(0 if r.get('ok',True) else 1)
