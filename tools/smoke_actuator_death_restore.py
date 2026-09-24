"""Real isolated death/restore lifecycle; no production save, identity, model or service writes."""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import time
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BODY = 'd4ac9523-4962-43ed-98c5-19b49e104048'
OWNER = 'e5005711-be9f-44b7-aaad-6993c0ba5df4'


def run(args, timeout=90, check=True):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding='utf8', errors='replace', timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(result.stderr[-4000:] or result.stdout[-4000:])
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-isolated', action='store_true', required=True)
    parser.add_argument('--candidate-build-record', type=Path, required=True)
    parser.add_argument('--spawn-geometry', type=Path, help='Saved block-only spawn volume copied into the isolated test world')
    parser.add_argument('--spawn-high-columns', type=Path, help='Saved sparse full-height columns; required with spawn geometry')
    args = parser.parse_args()
    record = json.loads(args.candidate_build_record.read_text('utf8'))
    jar = Path(record['jar'])
    if hashlib.sha256(jar.read_bytes()).hexdigest() != record['sha256']:
        raise ValueError('candidate_hash_mismatch')
    for name, expected in record['sources'].items():
        if hashlib.sha256((ROOT/name).read_bytes()).hexdigest() != expected:
            raise ValueError('candidate_sources_changed')
    ident = uuid.uuid4().hex[:12]
    project = 'qiandengji-actuator-death-qa-' + ident
    folder = (ROOT/'runtime'/('actuator-death-qa-'+ident)).resolve()
    if not folder.is_relative_to((ROOT/'runtime').resolve()) or folder.exists():
        raise ValueError('invalid_qa_directory')
    data = folder/'data'; (data/'mods').mkdir(parents=True)
    geometry_sha = None
    high_columns_sha = None
    if args.spawn_geometry:
        if not args.spawn_high_columns:
            raise ValueError('real_high_columns_required_with_geometry')
        raw = args.spawn_geometry.read_bytes()
        geometry = json.loads(raw)
        if geometry.get('bounds') != {'min':[-558,61,857], 'max':[-529,71,879]}:
            raise ValueError('expected_spawn_geometry_bounds_required')
        geometry_sha = hashlib.sha256(raw).hexdigest()
        (data/'qa-spawn-geometry.json').write_bytes(raw)
        high_raw = args.spawn_high_columns.read_bytes()
        high = json.loads(high_raw)
        if high.get('source') != 'saved_one_region_not_live' or not high.get('columns'):
            raise ValueError('saved_high_columns_required')
        high_columns_sha = hashlib.sha256(high_raw).hexdigest()
        (data/'qa-spawn-high-columns.json').write_bytes(high_raw)
    print(json.dumps({'stage':'preparing','folder':str(folder),'project':project}), flush=True)
    for mod in (ROOT/'server/mc/mods').glob('*.jar'):
        if mod.name != 'numen_act-neoforge-1.21.1-0.1.3.jar':
            shutil.copyfile(mod,data/'mods'/mod.name)
    shutil.copyfile(jar,data/'mods/numen_act-neoforge-1.21.1-0.1.3.jar')
    core = data/'mods/numen-neoforge-1.21.1-0.1.3.jar'
    if hashlib.sha256(core.read_bytes()).hexdigest() != record['numenSha256']:
        raise ValueError('actual_core_dependency_changed')
    spec=importlib.util.spec_from_file_location('restore_qa_cp',ROOT/'world/botgate-src/build.py')
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    embedded=folder/'numen-api.jar'
    with zipfile.ZipFile(core) as archive:
        names=[n for n in archive.namelist() if n.startswith('META-INF/jarjar/') and n.endswith('.jar') and 'numen_api' in n]
        if len(names)!=1:raise ValueError('exact_numen_api_required')
        embedded.write_bytes(archive.read(names[0]))
    cp=os.pathsep.join([helper.full_cp(ROOT/'server/mc/libraries'),str(embedded),*(str(p) for p in (data/'mods').glob('*.jar'))])
    classes=folder/'qa-classes';classes.mkdir()
    javac=Path(os.environ.get('JDK21_BIN',r'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin'))/'javac.exe'
    source=ROOT/'world/numen-actuator-src/tests/DeathRestoreQa.java'
    quote=lambda value:'"'+str(value).replace('\\','/')+'"'
    (folder/'javac.args').write_text('\n'.join(['-proc:none','--release','21','-encoding','UTF-8','-cp',quote(cp),'-d',quote(classes),quote(source)]),'utf8')
    run([str(javac),'@'+str(folder/'javac.args')])
    with zipfile.ZipFile(data/'mods/qiandeng-death-qa.jar','w',zipfile.ZIP_DEFLATED) as output:
        for entry in classes.rglob('*.class'):output.write(entry,entry.relative_to(classes).as_posix())
        output.writestr('META-INF/neoforge.mods.toml','modLoader="javafml"\nloaderVersion="[4,)"\nlicense="MIT"\n[[mods]]\nmodId="qiandeng_death_restore_qa"\nversion="0.0.1"\ndisplayName="Isolated death restore QA"\n')
    password=secrets.token_hex(16)
    (data/'eula.txt').write_text('eula=true\n','ascii')
    (data/'server.properties').write_text('\n'.join(['level-name=qa-world','level-type=minecraft:flat','online-mode=false','enforce-secure-profile=false',
        'enable-rcon=true','rcon.port=25575','rcon.password='+password,'view-distance=2','simulation-distance=2','difficulty=normal',
        'spawn-protection=0','max-tick-time=120000','allow-flight=true','']), 'ascii')
    image=run(['docker','image','inspect','itzg/minecraft-server:java21','--format','{{.Id}}']).stdout.strip()
    compose={'services':{'mc':{'image':image,'entrypoint':['java','-Xms1G','-Xmx3G','@libraries/net/neoforged/neoforge/21.1.248/unix_args.txt','nogui'],
        'working_dir':'/data','environment':{'QD_QA_FIXTURE':'isolated-death-restore','RCON_PASSWORD':password},
        'volumes':[f'{data.as_posix()}:/data',f'{(ROOT/"server/mc/libraries").as_posix()}:/data/libraries:ro'],
        'networks':['qa'],'stop_grace_period':'60s'}},'networks':{'qa':{'internal':True}}}
    path=folder/'compose.json';path.write_text(json.dumps(compose),'utf8')
    base=['docker','compose','-p',project,'-f',str(path)]
    checks={};details={}
    def command(text):return run([*base,'exec','-T','mc','rcon-cli',text],timeout=45).stdout
    def response(text,prefix='QD_DEATH_QA '):
        raw=command(text)
        if prefix not in raw:raise ValueError('unexpected_reply:'+raw[-500:])
        # This fixture emits one JSON line. rcon-cli inserts line breaks between
        # protocol chunks, including inside a JSON string; remove transport-only breaks.
        return json.JSONDecoder().raw_decode(''.join(raw.split(prefix,1)[1].splitlines()))[0]
    def restore(owner=OWNER):return response(f'numen_restore_existing {BODY} {owner} Kirito','QD_NUMEN_RESTORE_JSON ')
    def status():return response('qddeathqa status')
    def pending():
        deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            s=status()
            if not s['bodyOnline'] and s['pendingDeath']>0 and s['gameTime']-s['pendingDeath']>=100:return s
            time.sleep(1)
        raise RuntimeError('native_death_did_not_settle')
    def boot():
        deadline=time.monotonic()+420
        while time.monotonic()<deadline:
            try:
                s=status()
                if s.get('ok'):return s
            except (RuntimeError,ValueError):pass
            if 'exited' in run([*base,'ps','-a','--format','json'],check=False).stdout.lower():break
            time.sleep(5)
        raise RuntimeError('isolated_boot_failed')
    try:
        run([*base,'up','-d'],timeout=180);boot()
        checks['actual-neoforge-start']=True
        before=response('qddeathqa setup');details['setup']=before
        checks['existing-exact-owner-offline']=before['uuid']==BODY and before['ownerUuid']==OWNER and not before['ownerOnline'] and before['registryCount']==1
        checks['unloaded-landing-read-does-not-load']=not before['farChunkLoaded'] and not before['farChunkLoadedAfter'] and before['farSafeRejected']
        checks['unloaded-worldspawn-column-does-not-load']=before['farWorldSpawnColumnRejected'] and not before['farChunkLoadedAfterColumn']
        offline=response('qddeathqa offline');details['ordinaryOffline']=offline
        checks['ordinary-offline-not-death']=not offline['bodyOnline'] and offline['pendingDeath']==0
        ordinary_raw=command('qddeathqa restore');ordinary_at=time.monotonic()
        ordinary=json.JSONDecoder().raw_decode(''.join(ordinary_raw.split('QD_NUMEN_RESTORE_JSON ',1)[1].splitlines()))[0]
        ordinary_after=json.JSONDecoder().raw_decode(''.join(ordinary_raw.split('QD_DEATH_QA ',1)[1].splitlines()))[0]
        details['ordinaryRestore']={'receipt':ordinary,'after':ordinary_after}
        checks['ordinary-offline-original-position-uuid']=ordinary['ok'] and ordinary.get('recovery') is None and ordinary_after['uuid']==BODY and all(abs(ordinary_after[k]-before[k])<0.01 for k in ('x','y','z'))
        checks['ordinary-offline-inventory-food-xp']=ordinary_after.get('savedInventoryMatchesLive') is True and ordinary_after['food']==offline['savedFood'] and ordinary_after['xp']==offline['savedXp']
        # Keep the actual per-body restore cooldown; never reset production/fixture clocks.
        while time.monotonic()-ordinary_at<61:time.sleep(min(5,61-(time.monotonic()-ordinary_at)))
        busy=response('qddeathqa busy');details['busy']=busy
        checks['actual-native-task-before-death']=busy['taskTool']=='goto' and busy['currentTask']
        response('qddeathqa die');dead=pending();details['postDeathKept']=dead
        checks['native-busy-death-forgets-task']=dead['taskTool']=='' and not dead['currentTask']
        checks['native-death-persisted-before-restore']=dead['pendingDeath']>0 and not dead['bodyOnline'] and dead['savedHealth']>0
        denied=restore(str(uuid.uuid4()));details['wrongOwner']=denied
        checks['wrong-owner-refused']=not denied['ok'] and denied['code']=='registry_identity_mismatch'
        response('qddeathqa unsafe_spawn');unsafe=restore();details['unsafe']=unsafe
        checks['unsafe-spawn-refused-before-create']=not unsafe['ok'] and unsafe['code']=='death_safe_spawn_unavailable' and not status()['bodyOnline']
        response('qddeathqa safe_spawn')
        if args.spawn_geometry:
            geometry_observation=response('qddeathqa spawn_geometry');details['spawnGeometry']=geometry_observation
            checks['real-water-under-air-anchor-reproduced']=geometry_observation['anchorFeetAir'] and geometry_observation['oldLowerFootWater'] and geometry_observation['oldLowerStandingAccepted']
            selected=geometry_observation.get('selectedSurface')
            checks['surface-selector-rejects-lower-water-pocket']=selected is not None and selected[1]>63 and geometry_observation['selectedFeetDry']
            checks['high-sky-roof-cannot-replace-ground-spawn']=(geometry_observation['realHighColumnsApplied'] > 0 and geometry_observation['realSkyBlocksApplied'] > 0 and geometry_observation['highRoofAt178'] and geometry_observation['selectedWithinSpawnHeightBand'] and geometry_observation['realAndAdversarialSelectionEqual'])
        response('qddeathqa stale_task')
        first=restore();first_at=time.monotonic();after=status()
        details['keptRestore']={'receipt':first,'after':after}
        checks['same-uuid-native-death-respawn']=first['ok'] and first.get('recovery')=='native_post_death' and after['uuid']==BODY and after['ownerUuid']==OWNER and after['pendingDeath']==0
        checks['kept-inventory-food-xp-preserved']=all(first.get(key) is True for key in ('postDeathInventoryMatched','postDeathFoodMatched','postDeathXpMatched')) and after['cake']==1 and after['cakeOffhand'] and after['sword']==1
        checks['stale-interrupted-task-never-replayed']=after['taskTool']=='' and not after['currentTask']
        anchor=(-540,64,868) if args.spawn_geometry else (0,-60,0)
        checks['safe-world-spawn-not-death-position']=after['safeLanding'] and abs(after['x']-anchor[0])<=3.5 and abs(after['z']-anchor[2])<=3.5 and abs(after['x']-before['x'])>3
        if args.spawn_geometry:
            checks['actual-death-restores-on-dry-surface']=first['ok'] and after['feetDry'] and after['y']>63
        again=restore();details['alreadyOnline']=again
        checks['repeat-live-observation-not-second-body']=again['ok'] and again['phase']=='observed' and status()['rosterCount']==1
        journals=list((data/'qa-world/data/qd-numen-restores').glob('*.json'))
        audit=json.loads(journals[0].read_text()) if len(journals)==1 else {}
        checks['death-audit-completed-with-original-cause']=audit.get('status')=='completed' and audit.get('deathAt')==dead['pendingDeath'] and bool(audit.get('deathCause')) and len(audit.get('sourcePlayerdataSha256',''))==64
        if args.spawn_geometry:
            time.sleep(5)  # let pasted bounded-volume gravity/fluid updates settle
            details['nativeWalkDispatch']=response('qddeathqa walk_exit')
            pasted_diff=data/'qa-geometry-before-walk.json'
            details['pastedGeometryChangesBeforeWalk']={'path':str(pasted_diff),'sha256':hashlib.sha256(pasted_diff.read_bytes()).hexdigest(),'count':len(json.loads(pasted_diff.read_text('utf8')))}
            deadline=time.monotonic()+35
            walked=status()
            while time.monotonic()<deadline and (walked['currentTask'] or not walked.get('walkReply')):
                time.sleep(1);walked=status()
            details['drySurfaceWalk']=walked
            checks['real-native-walk-from-surface-to-dry-exit']=not walked['currentTask'] and ((walked['x']+535.5)**2+(walked['z']-873.5)**2)**.5<=1.5 and int(walked['y'])==63 and ((walked['x']-after['x'])**2+(walked['z']-after['z'])**2)**.5>3
            checks['surface-walk-did-not-edit-solid-geometry']=walked['geometryChangedSolidBlocks']==0
        response('qddeathqa die_drop');dropped=pending();details['postDeathDropped']=dropped
        checks['actual-death-removes-items-before-restore']=dropped['savedInventorySha256']!=dead['savedInventorySha256']
        print(json.dumps({'stage':'first_restore_checked','checks':checks}),flush=True)
        # Respect the actual native restore cooldown; never patch clocks or clear attempts.
        while time.monotonic()-first_at<61:time.sleep(min(5,61-(time.monotonic()-first_at)))
        second=restore();after_drop=status();details['droppedRestore']={'receipt':second,'after':after_drop}
        checks['death-drop-not-refunded']=second['ok'] and all(second.get(key) is True for key in ('postDeathInventoryMatched','postDeathFoodMatched','postDeathXpMatched')) and after_drop['cake']==0 and after_drop['sword']==0
        response('qddeathqa die');third=pending();response('qddeathqa claim_unknown')
        command('save-all flush');run([*base,'stop','-t','60','mc'],timeout=100)
        run([*base,'start','mc'],timeout=60);restarted=boot()
        unknown=restore();repeated=restore();observed=status();details['unknownAfterRestart']={'before':third,'restarted':restarted,'first':unknown,'second':repeated,'after':observed}
        checks['unknown-claim-survives-restart-no-replay']=unknown['phase']=='unknown' and repeated['phase']=='unknown' and not observed['bodyOnline'] and observed['registryCount']==1 and observed['pendingDeath']==third['pendingDeath']
    except Exception as error:
        details['failure']=str(error)[:4000];checks['execution-completed']=False
    finally:
        (folder/'server-final.log').write_text(run([*base,'logs','--no-color'],check=False).stdout,'utf8')
        stopped=run([*base,'down','--timeout','60'],timeout=120,check=False)
        checks['isolated-services-removed']=stopped.returncode==0 and not run([*base,'ps','-a','-q'],check=False).stdout.strip()
    report={'ok':all(checks.values()),'checks':checks,'details':details,'jarSha256':record['sha256'],'numenJarSha256':record['numenSha256'],'project':project,
        'network':'isolated_docker_internal_no_published_ports','productionWorldUsed':False,
        'modelCalls':0,'productionMutations':0,'fixtureSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
        'spawnGeometrySha256':geometry_sha,
        'spawnHighColumnsSha256':high_columns_sha,
        'toolSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'scope':'fresh isolated world with installed mods, real vanilla death and Numen factory, no production save or LLM'}
    (folder/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf8')
    print(json.dumps({'ok':report['ok'],'checks':checks,'report':str(folder/'result.json')}),flush=True)
    return 0 if report['ok'] else 1


if __name__=='__main__':raise SystemExit(main())
