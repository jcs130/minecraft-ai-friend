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
    args = parser.parse_args()
    record = json.loads((ROOT/'runtime/numen-body-restore-build/latest.json').read_text('utf8'))
    jar = Path(record['jar'])
    if hashlib.sha256(jar.read_bytes()).hexdigest() != record['sha256']:
        raise ValueError('candidate_hash_mismatch')
    for name, expected in record['sourceFiles'].items():
        if hashlib.sha256((ROOT/name).read_bytes()).hexdigest() != expected:
            raise ValueError('candidate_sources_changed')
    ident = uuid.uuid4().hex[:12]
    project = 'qiandengji-death-qa-' + ident
    folder = (ROOT/'runtime'/('numen-death-qa-'+ident)).resolve()
    if not folder.is_relative_to((ROOT/'runtime').resolve()) or folder.exists():
        raise ValueError('invalid_qa_directory')
    data = folder/'data'; (data/'mods').mkdir(parents=True)
    print(json.dumps({'stage':'preparing','folder':str(folder),'project':project}), flush=True)
    for mod in (ROOT/'server/mc/mods').glob('*.jar'):
        if mod.name != 'numen-neoforge-1.21.1-0.1.1.jar':
            shutil.copyfile(mod,data/'mods'/mod.name)
    shutil.copyfile(jar,data/'mods/numen-neoforge-1.21.1-0.1.1.jar')
    spec=importlib.util.spec_from_file_location('restore_qa_cp',ROOT/'world/botgate-src/build.py')
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    embedded=folder/'numen-api.jar'
    with zipfile.ZipFile(jar) as archive:
        names=[n for n in archive.namelist() if n.startswith('META-INF/jarjar/') and n.endswith('.jar') and 'numen_api' in n]
        if len(names)!=1:raise ValueError('exact_numen_api_required')
        embedded.write_bytes(archive.read(names[0]))
    cp=os.pathsep.join([helper.full_cp(ROOT/'server/mc/libraries'),str(embedded),*(str(p) for p in (data/'mods').glob('*.jar'))])
    classes=folder/'qa-classes';classes.mkdir()
    javac=Path(os.environ.get('JDK21_BIN',r'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin'))/'javac.exe'
    source=ROOT/'world/numen-patches/tests/DeathRestoreQa.java'
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
        busy=response('qddeathqa busy');details['busy']=busy
        checks['actual-native-task-before-death']=busy['taskTool']=='goto' and busy['currentTask']
        response('qddeathqa die');dead=pending();details['postDeathKept']=dead
        checks['native-busy-death-forgets-task']=dead['taskTool']=='' and not dead['currentTask']
        checks['native-death-persisted-before-restore']=dead['pendingDeath']>0 and not dead['bodyOnline'] and dead['savedHealth']>0
        denied=restore(str(uuid.uuid4()));details['wrongOwner']=denied
        checks['wrong-owner-refused']=not denied['ok'] and denied['code']=='registry_identity_mismatch'
        response('qddeathqa unsafe_spawn');unsafe=restore();details['unsafe']=unsafe
        checks['unsafe-spawn-refused-before-create']=not unsafe['ok'] and unsafe['code']=='death_safe_spawn_unavailable' and not status()['bodyOnline']
        response('qddeathqa safe_spawn');response('qddeathqa stale_task')
        first=restore();first_at=time.monotonic();after=status()
        details['keptRestore']={'receipt':first,'after':after}
        checks['same-uuid-native-death-respawn']=first['ok'] and first.get('recovery')=='native_post_death' and after['uuid']==BODY and after['ownerUuid']==OWNER and after['pendingDeath']==0
        checks['kept-inventory-food-xp-preserved']=all(first.get(key) is True for key in ('postDeathInventoryMatched','postDeathFoodMatched','postDeathXpMatched')) and after['cake']==1 and after['cakeOffhand'] and after['sword']==1
        checks['stale-interrupted-task-never-replayed']=after['taskTool']=='' and not after['currentTask']
        checks['safe-world-spawn-not-death-position']=after['safeLanding'] and abs(after['x'])<=3.5 and abs(after['z'])<=3.5 and abs(after['x']-before['x'])>3
        again=restore();details['alreadyOnline']=again
        checks['repeat-live-observation-not-second-body']=again['ok'] and again['phase']=='observed' and status()['rosterCount']==1
        journals=list((data/'qa-world/data/qd-numen-restores').glob('*.json'))
        audit=json.loads(journals[0].read_text()) if len(journals)==1 else {}
        checks['death-audit-completed-with-original-cause']=audit.get('status')=='completed' and audit.get('deathAt')==dead['pendingDeath'] and bool(audit.get('deathCause')) and len(audit.get('sourcePlayerdataSha256',''))==64
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
    report={'ok':all(checks.values()),'checks':checks,'details':details,'jarSha256':record['sha256'],'project':project,
        'modelCalls':0,'productionMutations':0,'fixtureSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
        'toolSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'scope':'fresh isolated world with installed mods, real vanilla death and Numen factory, no production save or LLM'}
    (folder/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf8')
    print(json.dumps({'ok':report['ok'],'checks':checks,'report':str(folder/'result.json')}),flush=True)
    return 0 if report['ok'] else 1


if __name__=='__main__':raise SystemExit(main())
