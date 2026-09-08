"""Install the verified shared item JAR only into the isolated D project."""
from datetime import datetime, timezone
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MOD = 'qiandeng_chanting'
NAME = 'qiandeng-chanting-0.1.0.jar'
ITEMS = ['qiandeng_chanting:whispering_staff', 'qiandeng_chanting:resonance_staff']

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path): return json.loads(path.read_text(encoding='utf-8-sig'))
def write(path, value):
    tmp = path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8'); tmp.replace(path)
def docker(*args, timeout=120):
    proc=subprocess.run(['docker','compose','--project-directory',str(ROOT),'-f',str(ROOT/'compose.yml'),'-p','qiandengji',*args],
        cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=timeout)
    if proc.returncode: raise RuntimeError('Isolated Docker operation failed: '+args[0])
    return proc.stdout.strip()
def wait_health(service, timeout=240):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        proc=subprocess.run(['docker','inspect','qiandengji-'+service+'-1','--format','{{.State.Health.Status}}'],capture_output=True,text=True,timeout=10)
        if proc.returncode==0 and proc.stdout.strip()=='healthy': return
        time.sleep(2)
    raise RuntimeError(service+' did not become healthy')

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--execute',choices=['qiandengji'],required=True)
    modes=ap.add_mutually_exclusive_group()
    modes.add_argument('--resume',action='store_true',help='Resume this recorded first installation after a validated build failure')
    modes.add_argument('--resources-only',action='store_true',help='Upgrade only the two staff model assets, keeping all installed code identical')
    modes.add_argument('--upgrade',action='store_true',help='Upgrade the verified local staff and recorder build from the recorded installed versions')
    args=ap.parse_args()
    assert ROOT.resolve()==Path('D:/Projects/QiandengJi').resolve(), 'Only the isolated D project is allowed'
    assert not (ROOT/'server/world-data/.qiandengji-smoke.lock').exists(), 'A live QA check is active'
    record_path=ROOT/'runtime/chanting-build/build-record.json'
    build=read(record_path); artifact=Path(build['jar']).resolve()
    assert artifact.is_relative_to((ROOT/'vendor/chanting-cache').resolve()) and sha(artifact)==build['sha256']
    assert all(sha(ROOT/row['path']) == row['sha256'] for row in build['source_files']), 'Rebuild the item mod after source changes'
    with zipfile.ZipFile(artifact) as z:
        assert z.testzip() is None
        metadata=z.read('META-INF/neoforge.mods.toml').decode('utf-8')
        assert MOD in metadata and 'qiandeng_chanting.client.mixins.json' in z.namelist()
        for item in ['whispering_staff','resonance_staff']:
            assert f'assets/{MOD}/models/item/{item}.json' in z.namelist()
            assert f'data/{MOD}/recipe/{item}.json' in z.namelist()
    server=ROOT/'server/mc/mods'/NAME; client=ROOT/'client/mods'/NAME
    editor_record=read(ROOT/'world/botgate-src/build-record.json')
    editor=ROOT/'world/botgate-src/botgate.jar'; editor_target=ROOT/'server/mc/mods/botgate.jar'
    assert sha(editor)==editor_record['sha256'] and all(sha(ROOT/'world/botgate-src'/p)==v for p,v in editor_record['sources'].items())
    recorder_record=read(ROOT/'runtime/god-voice-build/build-record.json')
    recorder=ROOT/'vendor/god-voice-cache/god-voice-0.1.0.jar'; recorder_target=ROOT/'server/mc/mods/god-voice-0.1.0.jar'
    assert recorder_record['ok'] and recorder_record['recording_schema']==2 and sha(recorder)==recorder_record['sha256']
    assert all(sha(ROOT/row['path'])==row['sha256'] for row in recorder_record['source_files'])
    previous=None
    resource_diff=None
    if args.resume or args.resources_only or args.upgrade:
        previous=read(ROOT/'reports/chanting-items-deployment.json')
        assert previous['project']=='qiandengji' and previous['ok'] is bool(args.resources_only or args.upgrade) and server.exists()
        old_lock=read(ROOT/'manifests/chanting-items.lock.json')['files'][0]
        assert sha(server)==old_lock['sha256'] and (not client.exists() or sha(client)==old_lock['sha256'])
        if args.upgrade:
            assert client.exists() and previous['jarSha256']==sha(server)
            assert sha(editor_target)==previous['editorJar']['after'] and sha(recorder_target)==previous['recorderJar']['after']
            assert sha(ROOT/'client/mods/god-voice-0.1.0.jar')==sha(recorder_target)
            assert sha(recorder_target)==read(ROOT/'manifests/recording-extension.lock.json')['files'][0]['sha256']
        if args.resources_only:
            assert client.exists() and previous['jarSha256']==sha(server)
            assert sha(editor_target)==editor_record['sha256'] and sha(recorder_target)==recorder_record['sha256']
            allowed={f'assets/{MOD}/models/item/{item}.json' for item in ['whispering_staff','resonance_staff']}
            with zipfile.ZipFile(server) as old, zipfile.ZipFile(artifact) as new:
                assert set(old.namelist())==set(new.namelist()), 'Resource upgrade cannot add or remove entries'
                changed={name for name in old.namelist() if old.read(name)!=new.read(name)}
                assert changed and changed<=allowed, 'Resource upgrade cannot change code or other resources'
                resource_diff={'beforeSha256':sha(server),'afterSha256':sha(artifact),'changedEntries':sorted(changed),
                               'allClassesUnchanged':True,'classCount':sum(name.endswith('.class') for name in old.namelist())}
    else:
        assert not server.exists() and not client.exists(), 'Use --resume only for this recorded interrupted installation'
    before_mods={p.relative_to(ROOT).as_posix():sha(p) for p in (ROOT/'server/mc/mods').glob('*.jar')}
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'); backup=ROOT/'runtime/backups'/('chanting-items-'+stamp)
    backup.mkdir(parents=True)
    report={'schema':1,'project':'qiandengji','ok':False,'startedAt':datetime.now(timezone.utc).isoformat(),
        'backup':str(backup.relative_to(ROOT)),'serverJarAdded':NAME,'clientJarAdded':NAME,'minecraftRestarted':False}
    if previous: report['previousDeployment' if (args.resources_only or args.upgrade) else 'previousAttempt']=previous
    if args.upgrade: report['verifiedBuildUpgrade']=True
    if resource_diff: report['resourceOnlyUpgrade']=resource_diff
    try:
        # Consumers stop before the save is flushed; only this project is addressed.
        docker('stop','world','npc','gate')
        docker('exec','-T','mc','rcon-cli','save-all flush')
        docker('stop','mc'); print(json.dumps({'stage':'D_save_flushed_and_stopped'}),flush=True)
        shutil.copy2(editor_target,backup/'botgate.jar')
        shutil.copy2(recorder_target,backup/'god-voice-0.1.0.jar')
        if server.exists(): shutil.copy2(server,backup/NAME)
        for folder in ['playerdata','advancements','stats']:
            source=ROOT/'server/mc/shadow'/folder
            assert source.resolve().is_relative_to((ROOT/'server/mc/shadow').resolve())
            shutil.copytree(source,backup/folder)
        for relative in ['server/mc/shadow/level.dat','server/mc/shadow/level.dat_old',
            'server/world-data/magic-state.json','server/world-data/waypoints.json',
            'manifests/client.lock.json','manifests/chanting-items.lock.json','manifests/recording-extension.lock.json',
            'manifests/deployed-server.lock.json','manifests/server-extensions.lock.json','config/content-mods.json']:
            p=ROOT/relative
            if p.exists(): target=backup/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
        cache=ROOT/'vendor/chanting-cache'/NAME;cache.parent.mkdir(parents=True,exist_ok=True)
        if artifact != cache.resolve(): shutil.copy2(artifact,cache)
        shutil.copy2(artifact,server)
        assert sha(server)==build['sha256'] and all(sha(ROOT/p)==v for p,v in before_mods.items() if p!=server.relative_to(ROOT).as_posix())
        shutil.copy2(editor,editor_target)
        assert sha(editor_target)==editor_record['sha256']
        shutil.copy2(recorder,recorder_target)
        lock={'schema_version':1,'minecraft':'1.21.1','neoforge':'21.1.248','client_only':False,'server_required':True,
              'files':[{'mod_id':MOD,'filename':NAME,'cache_path':cache.relative_to(ROOT).as_posix(),
                        'sha256':sha(cache),'size_bytes':cache.stat().st_size,'client_only':False,'source_build':'tools/build_chanting_items.py'}]}
        write(ROOT/'manifests/chanting-items.lock.json',lock)
        voice_lock={**lock,'files':[{'mod_id':'godvoice','filename':recorder.name,'cache_path':recorder.relative_to(ROOT).as_posix(),
            'sha256':sha(recorder),'size_bytes':recorder.stat().st_size,'client_only':False,'source_build':'world/god-voice-src/build.py'}]}
        write(ROOT/'manifests/recording-extension.lock.json',voice_lock)
        config=read(ROOT/'config/content-mods.json');config['shared_extension_locks']=list(dict.fromkeys(config.get('shared_extension_locks',[])+['manifests/chanting-items.lock.json','manifests/recording-extension.lock.json']))
        write(ROOT/'config/content-mods.json',config)
        # Existing builder validates all dependencies, preserves edited settings,
        # and owns the exact client file lock including this new shared artifact.
        import pack_builder
        result=pack_builder.build(config,ROOT)
        assert not result['errors'], 'Client dependency/build validation failed'
        assert sha(client)==sha(server)
        extensions=read(ROOT/'manifests/server-extensions.lock.json')
        extensions['files']=[row for row in extensions['files'] if row['path'] not in [server.relative_to(ROOT).as_posix(),recorder_target.relative_to(ROOT).as_posix()]]
        for row in extensions['files']:
            if row['path']=='server/mc/mods/botgate.jar':row['sha256']=sha(editor_target)
        extensions['files'].append({'path':server.relative_to(ROOT).as_posix(),'sha256':sha(server),'client_required':True})
        extensions['files'].append({'path':recorder_target.relative_to(ROOT).as_posix(),'sha256':sha(recorder_target),'client_required':False})
        write(ROOT/'manifests/server-extensions.lock.json',extensions)
        mods=read(ROOT/'manifests/deployed-server.lock.json')
        mods['mods']=[row for row in mods['mods'] if row['path']!=server.relative_to(ROOT).as_posix()]
        for row in mods['mods']:
            if row['path']=='server/mc/mods/botgate.jar':row['sha256']=sha(editor_target);row['size']=editor_target.stat().st_size
            if row['path']=='server/mc/mods/god-voice-0.1.0.jar':row['sha256']=sha(recorder_target);row['size']=recorder_target.stat().st_size
        mods['mods'].append({'path':server.relative_to(ROOT).as_posix(),'size':server.stat().st_size,'sha256':sha(server)})
        mods['mods'].sort(key=lambda x:x['path']);mods['mod_count']=len(mods['mods']);mods['recorded_at']=datetime.now(timezone.utc).isoformat()
        write(ROOT/'manifests/deployed-server.lock.json',mods)
        docker('up','-d','--no-deps','mc');report['minecraftRestarted']=True
        print(json.dumps({'stage':'starting_D_with_custom_items'}),flush=True)
        wait_health('mc')
        raw=docker('exec','-T','mc','rcon-cli','qdchant health')
        lines=[line for line in raw.splitlines() if line.startswith('QD_CHANT_JSON ')]
        assert len(lines)==1;health=json.loads(lines[0][len('QD_CHANT_JSON '):])
        assert health['ok'] and health['schema']==1 and sorted(health['items'])==sorted(ITEMS)
        docker('up','-d','--no-deps','world','npc','gate')
        docker('restart','asr')
        wait_health('world');wait_health('npc')
        wait_health('asr')
        unchanged=all(sha(ROOT/p)==v for p,v in before_mods.items() if p not in ['server/mc/mods/botgate.jar','server/mc/mods/god-voice-0.1.0.jar',server.relative_to(ROOT).as_posix()])
        assert unchanged
        report.update({'ok':True,'health':health,'existingServerJarsUnchangedExceptEditorAndRecorder':unchanged,'jarSha256':sha(server),
            'editorJar':{'path':'server/mc/mods/botgate.jar','before':before_mods['server/mc/mods/botgate.jar'],'after':sha(editor_target)},
            'recorderJar':{'path':'server/mc/mods/god-voice-0.1.0.jar','before':before_mods['server/mc/mods/god-voice-0.1.0.jar'],'after':sha(recorder_target),'schema':2},
            'clientJarCount':result['jar_count'],'serverJarCount':mods['mod_count'],'clientSettingsPreserved':result.get('preserved_existing_files',[]),
            'scope':'Installed shared custom items, preserved existing JARs/progress snapshot, clean server registration; gameplay and client rendering checked separately'})
    except Exception as error:
        report['error']=str(error)[:400]
        # Restore consumers when possible; do not silently uninstall a registered
        # content mod or overwrite the running world as an automatic rollback.
        try: docker('up','-d','--no-deps','mc','world','npc','gate')
        except Exception: pass
    finally:
        report['finishedAt']=datetime.now(timezone.utc).isoformat()
        write(ROOT/'reports/chanting-items-deployment.json',report)
        print(json.dumps({k:report.get(k) for k in ['ok','error','clientJarCount','serverJarCount']}),flush=True)
    return 0 if report['ok'] else 1

if __name__=='__main__': raise SystemExit(main())
