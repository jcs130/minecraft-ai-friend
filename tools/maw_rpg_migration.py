"""Install/check the owned Paper gameplay port. Does not copy old accounts/worlds."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import time
from urllib.request import urlopen
import zipfile
from build_society_bridge import ensure_server_stopped
from society_lab import REPO, DEFAULT_ROOT

PACK=REPO/'world/society-datapacks/maw_rpg'
REQUIRED={'rpg.state','rpg.skills','skill.cast','skill.learn','skill.upgrade','land.claim',
          'land.trust','protection.query','arena.status','arena.start','stash.open',
          'arena.recycle.quote','arena.recycle.sell','arena.shop.buy'}

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def install(root:Path=DEFAULT_ROOT,server:Path|None=None,world='world-life'):
    server=(server or root/'server').resolve()
    if root.resolve() not in server.parents or not world or Path(world).name!=world:
        raise ValueError('Use a server and simple world name inside the owned runtime')
    ensure_server_stopped(server)
    dest=server/world/'datapacks/maw_rpg';lock=server/'maw-rpg-installation.json'
    if dest.exists():
        previous=json.loads(lock.read_bytes()) if lock.exists() else None
        if not previous or any(not (dest/n).is_file() or sha(dest/n)!=h for n,h in previous['packFiles'].items()):
            raise ValueError('Unmanaged or changed RPG pack; preserve and reconcile before updating')
    files={p.relative_to(PACK).as_posix():sha(p) for p in PACK.rglob('*') if p.is_file()}
    for name in files:
        target=dest/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(PACK/name,target)
    record={'schemaVersion':1,'world':world,'packFiles':files,'historicalAccountsImported':False,
            'newDimension':'maw:trials','overworldStructuresOverwritten':False,
            'sourceRevision':'a58debc','sourcePlugin':'AgentFriend 0.4.23'}
    lock.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    return record

def probe(root:Path=DEFAULT_ROOT):
    checks={};r={'schemaVersion':1,'scope':'installed_rpg_rules_not_all_legacy_features_or_gameplay',
                 'checks':checks,'modelRequests':0,'worldActions':0,'ok':False}
    try:
        server=root/'server';record=json.loads((server/'maw-rpg-installation.json').read_bytes())
        pack=server/record['world']/'datapacks/maw_rpg'
        checks['owned-pack-bytes']=all(sha(pack/n)==h for n,h in record['packFiles'].items())
        checks['correct-dimension']=json.loads((pack/'data/maw/dimension/trials.json').read_bytes())['generator']['type']=='minecraft:flat'
        bridge=server/'mods/maw_agent_bridge-0.1.0.jar';build=json.loads((root/'build/society-bridge/build-record.json').read_bytes())
        checks['compiled-artifact']=sha(bridge)==build['sha256']
        with zipfile.ZipFile(bridge) as z:
            catalog=json.loads(z.read('maw-rpg-catalog.json'));ops=json.loads(z.read('maw-native-operations.json'))
            checks['36-skills-15-floors']=len(catalog['skills'])==36 and len(catalog['floors'])==15
            checks['native-rpg-operations']=REQUIRED<={row['id'] for row in ops['operations']}
            checks['core-services-compiled']=all('dev/qiandeng/maw/'+n+'.class' in z.namelist() for n in ('RpgStore','RpgSkills','RpgProtection','RpgStorage','RpgTrials','RpgMessages'))
        config=json.loads((root/'services/service.json').read_bytes());gate=next(s for s in config['services'] if s['id']=='gate')
        checks['private-state-channels']={'mcagent:state','mcagent:event','mcagent:protection','mcviewer:state'}<=set(gate['env']['GATE_EXTRA_PLAY_CHANNELS'].split(','))
        health=json.load(urlopen('http://127.0.0.1:28985/healthz',timeout=5))
        checks['fresh-owned-watchdog']=health['healthy'] is True and 0<=time.time()-health['heartbeatEpoch']<20
        checks['no-account-autotransplant']=record['historicalAccountsImported'] is False
    except Exception as e:r['error']=str(e)[:300]
    r['ok']=len(checks)==9 and all(checks.values());return r

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('mode',choices=('install','health'));p.add_argument('--root',type=Path,default=DEFAULT_ROOT);p.add_argument('--server',type=Path);p.add_argument('--world',default='world-life');a=p.parse_args()
    result=install(a.root,a.server,a.world) if a.mode=='install' else probe(a.root)
    print(json.dumps(result,ensure_ascii=False,indent=2));raise SystemExit(0 if result.get('ok',True) else 1)
