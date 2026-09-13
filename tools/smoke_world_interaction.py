"""Real isolated Numen interaction receipts; never mounts or mutates production saves."""
from __future__ import annotations
import argparse
import base64
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

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'world/irons-bridge-src/qa/InteractionQa.java'
DEFAULT_JAR=ROOT/'world/irons-bridge-src/build/qiandeng-irons-bridge-0.1.0.jar'
BODY='d4ac9523-4962-43ed-98c5-19b49e104048'
OWNER='e5005711-be9f-44b7-aaad-6993c0ba5df4'
ARGS={'button':'right','x':3,'y':-60,'z':0,'hold_ticks':0,'item_id':'minecraft:dirt'}
PREFIX='QD_WORLD_INTERACTION_JSON '
PYTHON_SOURCES=('world_actions.py','numen_gateway.py')
PYTHON_CLIENT=r'''
import hashlib,json,sys,time,uuid
from pathlib import Path
from types import SimpleNamespace
from numen_gateway import RconClient
from world_actions import WorldActions

body='d4ac9523-4962-43ed-98c5-19b49e104048'
args={'button':'right','x':3,'y':-60,'z':0,'hold_ticks':0,'item_id':'minecraft:dirt'}
request=uuid.uuid4().hex
mode=sys.argv[1]
assert mode in ('normal','lost-ack')
native=RconClient(host='mc',port=25575,secret=Path('/qa/rcon-secret'))
commands=[];responses=[]
class Transport:
    def cmd(self,command):
        assert command.startswith(('qdworld interact '+body+' '+request+' ',
                                   'qdworld interaction '+body+' '+request))
        commands.append(command)
        raw=native.cmd(command)
        row={'bytes':len(raw.encode('utf8')),'sha256':hashlib.sha256(raw.encode('utf8')).hexdigest()}
        prefix='QD_WORLD_INTERACTION_JSON '
        try:row['receipt']=json.loads(raw.split(prefix,1)[1].strip())
        except (ValueError,IndexError):row['receipt']=None
        responses.append(row)
        if len(commands)==1 and mode=='lost-ack':
            raise ConnectionError('injected_lost_initial_ack_after_native_dispatch')
        return raw

state=Path('/tmp/interaction-state');state.mkdir()
gateway=SimpleNamespace(rcon=Transport(),state=state,_now=lambda:int(time.time()*1000))
began=time.monotonic()
result=None;error=None
try:result=WorldActions(gateway)._interaction({'bodyUuid':body,'actionId':request},args)
except Exception as exc:error=type(exc).__name__+':'+str(exc)
diagnostics={str(p.relative_to(state)):json.loads(p.read_text()) for p in state.rglob('*.json')}
print(json.dumps({'mode':mode,'actionId':request,'result':result,'error':error,'commands':commands,
    'responses':responses,'diagnostics':diagnostics,'elapsedSeconds':round(time.monotonic()-began,3)},ensure_ascii=True))
'''


def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(args,timeout=90,check=True):
    result=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding='utf8',errors='replace',timeout=timeout)
    if check and result.returncode:raise RuntimeError(result.stderr[-5000:] or result.stdout[-5000:])
    return result


def write(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')


def prepared_folder(value):
    folder=Path(value).resolve()
    if not folder.is_relative_to((ROOT/'runtime').resolve()) or not folder.name.startswith('interaction-qa-'):
        raise ValueError('invalid_isolated_fixture_directory')
    if any(p.is_symlink() or getattr(p,'is_junction',lambda:False)() for p in (folder,*folder.parents)):
        raise ValueError('linked_isolated_fixture_directory')
    return folder


def prepare():
    ident=uuid.uuid4().hex[:12]
    folder=prepared_folder(ROOT/'runtime'/('interaction-qa-'+ident))
    if folder.exists():raise ValueError('isolated_fixture_already_exists')
    data=folder/'data';(data/'mods').mkdir(parents=True)
    print(json.dumps({'stage':'preparing','folder':str(folder)}),flush=True)
    mod_sources=sorted((ROOT/'server/mc/mods').glob('*.jar'))
    for mod in mod_sources:shutil.copyfile(mod,data/'mods'/mod.name)
    numen=data/'mods/numen-neoforge-1.21.1-0.1.1.jar'
    with zipfile.ZipFile(numen) as archive:
        names=[n for n in archive.namelist() if n.startswith('META-INF/jarjar/') and n.endswith('.jar') and 'numen_api' in n]
        if len(names)!=1:raise ValueError('exact_numen_api_required')
        embedded=folder/'numen-api.jar';embedded.write_bytes(archive.read(names[0]))
    spec=importlib.util.spec_from_file_location('interaction_qa_classpath',ROOT/'world/botgate-src/build.py')
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    cp=os.pathsep.join([helper.full_cp(ROOT/'server/mc/libraries'),str(embedded),*(str(p) for p in (data/'mods').glob('*.jar'))])
    classes=folder/'qa-classes';classes.mkdir()
    javac=Path(os.environ.get('JDK21_BIN',r'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin'))/('javac.exe' if os.name=='nt' else 'javac')
    quote=lambda value:'"'+str(value).replace('\\','/')+'"'
    (folder/'javac.args').write_text('\n'.join(['-proc:none','--release','21','-encoding','UTF-8','-cp',quote(cp),'-d',quote(classes),quote(SOURCE)]),'utf8')
    run([str(javac),'@'+str(folder/'javac.args')])
    fixture=data/'mods/qiandeng-interaction-qa.jar'
    with zipfile.ZipFile(fixture,'w',zipfile.ZIP_DEFLATED) as archive:
        for entry in classes.rglob('*.class'):archive.write(entry,entry.relative_to(classes).as_posix())
        archive.writestr('META-INF/neoforge.mods.toml','modLoader="javafml"\nloaderVersion="[4,)"\nlicense="MIT"\n[[mods]]\nmodId="qiandeng_interaction_qa"\nversion="0.0.1"\ndisplayName="Isolated native interaction QA"\n')
    (data/'config').mkdir()
    write(data/'config/numen-autonomous-bodies.json',{'schema':1,'enabled':True,'bodies':[{'bodyUuid':BODY,'ownerUuid':OWNER,'bodyName':'Kirito'}]})
    password=secrets.token_hex(16)
    (folder/'rcon-secret').write_text(password+'\n','ascii')
    (data/'eula.txt').write_text('eula=true\n','ascii')
    (data/'server.properties').write_text('\n'.join(['level-name=qa-world','level-type=minecraft:flat','online-mode=false','enforce-secure-profile=false',
        'enable-rcon=true','rcon.port=25575','rcon.password='+password,'view-distance=2','simulation-distance=2','difficulty=normal',
        'spawn-protection=0','max-tick-time=120000','allow-flight=true','']),'ascii')
    image=run(['docker','image','inspect','itzg/minecraft-server:java21','--format','{{.Id}}']).stdout.strip()
    compose={'services':{'mc':{'image':image,'entrypoint':['java','-Xms1G','-Xmx3G','@libraries/net/neoforged/neoforge/21.1.248/unix_args.txt','nogui'],
        'working_dir':'/data','environment':{'QD_QA_FIXTURE':'isolated-world-interaction','RCON_PASSWORD':password},
        'volumes':[f'{data.as_posix()}:/data',f'{(ROOT/"server/mc/libraries").as_posix()}:/data/libraries:ro'],
        'networks':['qa'],'stop_grace_period':'60s'}},'networks':{'qa':{'internal':True}}}
    write(folder/'compose.json',compose)
    record={'schema':1,'project':'qiandengji-interaction-qa-'+ident,'fixtureSourceSha256':sha(SOURCE),'fixtureJarSha256':sha(fixture),
            'modSources':{p.name:sha(p) for p in mod_sources},'numenSha256':sha(numen),'productionSaveCopied':False,'publishedPorts':[]}
    write(folder/'prepared.json',record)
    print(json.dumps({'stage':'prepared','folder':str(folder),'mods':len(mod_sources),'fixtureCompiled':True}),flush=True)
    return folder


def python_fixture(folder):
    """Snapshot the reviewed Python source and use only the private QA network."""
    directory=folder/'python-qa';(directory/'survival').mkdir(parents=True)
    sources={}
    for name in PYTHON_SOURCES:
        source=ROOT/'world/survival'/name
        shutil.copyfile(source,directory/'survival'/name)
        sources['world/survival/'+name]=sha(source)
    (directory/'interaction_client.py').write_text(PYTHON_CLIENT,'utf8')
    compose=json.loads((folder/'compose.json').read_text('utf8'))
    # Prepared fixtures from the earlier Java-only QA retain the secret in their
    # private compose manifest; never copy any production RCON configuration.
    secret=folder/'rcon-secret'
    if not secret.exists():secret.write_text(compose['services']['mc']['environment']['RCON_PASSWORD']+'\n','ascii')
    shutil.copyfile(secret,directory/'rcon-secret')
    runtime=run(['docker','image','inspect','qiandengji-qwenpaw-game:2.2.0-recovery1','--format','{{.Id}}']).stdout.strip()
    compose['services']['python-qa']={'image':runtime,'profiles':['python-qa'],
        'entrypoint':['python','-B','/qa/interaction_client.py'],'environment':{'PYTHONPATH':'/qa/survival'},
        'volumes':[f'{directory.as_posix()}:/qa:ro'],
        'networks':['qa']}
    write(folder/'compose.json',compose)
    return {'sources':sources,'runtimeImage':runtime,'clientSha256':sha(directory/'interaction_client.py')}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    action=parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--prepare-only',action='store_true')
    action.add_argument('--run-isolated',action='store_true')
    parser.add_argument('--prepared',type=Path)
    parser.add_argument('--jar',type=Path,default=DEFAULT_JAR)
    args=parser.parse_args()
    folder=prepared_folder(args.prepared) if args.prepared else prepare()
    record=json.loads((folder/'prepared.json').read_text('utf8'))
    data=folder/'data'
    if record['fixtureSourceSha256']!=sha(SOURCE) or record['fixtureJarSha256']!=sha(data/'mods/qiandeng-interaction-qa.jar'):
        raise ValueError('prepared_fixture_changed')
    if args.prepare_only:return 0
    candidate=args.jar.resolve()
    build=json.loads(candidate.with_name('build-record.json').read_text('utf8'))
    if not build['ok'] or Path(build['jar']).resolve()!=candidate or build['sha256']!=sha(candidate):raise ValueError('candidate_hash_mismatch')
    for name,digest in build['sources'].items():
        if sha(ROOT/name)!=digest:raise ValueError('candidate_sources_changed:'+name)
    with zipfile.ZipFile(candidate) as archive:
        if 'dev/qiandeng/irons/WorldInteractionBridge.class' not in archive.namelist():raise ValueError('interaction_candidate_required')
    installed=[p for p in (data/'mods').glob('qiandeng-irons-bridge-*.jar')]
    if len(installed)!=1:raise ValueError('exact_isolated_bridge_required')
    shutil.copyfile(candidate,installed[0])
    if sha(installed[0])!=build['sha256']:raise ValueError('isolated_candidate_copy_mismatch')
    if (data/'qa-world/level.dat').exists():raise ValueError('fresh_isolated_world_required')
    python_record=python_fixture(folder)
    project=record['project'];base=['docker','compose','-p',project,'-f',str(folder/'compose.json')]
    checks={};details={};began=time.monotonic()
    def command(text):return run([*base,'exec','-T','mc','rcon-cli',text],timeout=45).stdout
    def response(text,prefix='QD_INTERACTION_QA '):
        raw=command(text)
        if prefix not in raw:raise ValueError('missing_native_reply:'+raw[-600:])
        return json.JSONDecoder().raw_decode(''.join(raw.split(prefix,1)[1].splitlines()))[0]
    def status():return response('qdinteractionqa status')
    def boot():
        deadline=time.monotonic()+420;last_notice=0
        while time.monotonic()<deadline:
            try:
                value=status()
                if value.get('ok'):return value
            except (RuntimeError,ValueError):pass
            if 'exited' in run([*base,'ps','-a','--format','json'],check=False).stdout.lower():break
            if time.monotonic()-last_notice>20:
                print(json.dumps({'stage':'booting','elapsedSeconds':round(time.monotonic()-began)}),flush=True);last_notice=time.monotonic()
            time.sleep(3)
        raise RuntimeError('isolated_boot_failed')
    def ground():
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            value=status()
            if value.get('onGround') and not value['currentTask']:return value
            time.sleep(.25)
        raise RuntimeError('native_body_not_grounded_and_idle')
    encoded=base64.urlsafe_b64encode(json.dumps(ARGS,separators=(',',':')).encode()).decode().rstrip('=')
    def query(request_id):return response(f'qdworld interaction {BODY} {request_id}',PREFIX)
    def submit(request_id):return response(f'qdworld interact {BODY} {request_id} {encoded}',PREFIX)
    def identity(row,request_id):
        assert row['schema']==1 and row['capability']=='numen_interaction_receipt_v1'
        assert row['actorUuid']==BODY and row['requestId']==request_id and row['tool']=='interact_at' and row['args']==ARGS
        assert str(uuid.UUID(row['epoch']))==row['epoch']
    def settle(request_id):
        first=submit(request_id);identity(first,request_id);row=first
        deadline=time.monotonic()+35
        while row['status'] in ('accepted','running') and time.monotonic()<deadline:
            time.sleep(.2);row=query(request_id);identity(row,request_id)
            assert row['epoch']==first['epoch']
        return first,row
    def stable(row):return {k:v for k,v in row.items() if k!='observedAt'}
    def checkpoint(stage):
        write(folder/'progress.json',{'stage':stage,'checks':checks,'details':details})
        print(json.dumps({'stage':stage,'checks':checks}),flush=True)
    failed_id=uuid.uuid4().hex;success_id=uuid.uuid4().hex;pending_id=uuid.uuid4().hex
    try:
        run([*base,'up','-d'],timeout=180);boot();checks['actual-neoforge-start']=True
        setup=response('qdinteractionqa setup');assert setup['ok'],setup
        before=ground();details['before']=before
        checks['exact-existing-numen-body']=before['uuid']==BODY and before['ownerUuid']==OWNER and not before['ownerOnline'] and before['registryCount']==1 and before['gameMode']=='survival'
        checks['actual-short-grass-ray-occlusion']=before['rayHitBlock']=='minecraft:short_grass'
        assert checks['actual-short-grass-ray-occlusion'],before
        accepted,failed=settle(failed_id);after_fail=status();details['occluded']={'accepted':accepted,'terminal':failed,'after':after_fail}
        checks['occlusion-is-native-terminal-failure']=failed['status']=='terminal' and failed.get('nativeState')=='FAILED' and failed['result']['success'] is False and 'short_grass' in failed['result']['message']
        checks['occlusion-does-not-consume-or-place']=after_fail['dirt']==8 and after_fail['placementBlock']=='minecraft:grass_block'
        assert checks['occlusion-is-native-terminal-failure'],failed
        clear=response('qdinteractionqa clear');assert clear['ok'],clear
        ready=ground();details['clear']=ready
        checks['normal-ray-hits-real-stone']=ready['rayHitBlock']=='minecraft:stone' and ready['rayHitPosition']=='3, -60, 0'
        accepted,success=settle(success_id);after_success=status();details['placed']={'accepted':accepted,'terminal':success,'after':after_success}
        checks['normal-click-native-success-and-real-placement']=success['status']=='terminal' and success['result']['success'] is True and after_success['dirt']==7 and after_success['placementBlock']=='minecraft:dirt'
        assert checks['normal-click-native-success-and-real-placement'],details['placed']
        removed=response('qdinteractionqa remove_placed');assert removed['ok'],removed
        duplicate=submit(success_id);after_duplicate=status();details['duplicate']={'reply':duplicate,'after':after_duplicate}
        checks['same-request-never-places-again-or-spends']=stable(duplicate)==stable(success) and after_duplicate['dirt']==7 and after_duplicate['placementBlock']=='minecraft:air'
        pending_arm=response('qdinteractionqa arm_'+pending_id);assert pending_arm['ok'],pending_arm
        command('save-all flush');checkpoint('native-clicks-verified')
        run([*base,'stop','-t','60','mc'],timeout=100)
        journal_dir=data/'qa-world/data/qiandeng-interactions'
        pending_file=journal_dir/(BODY+'-'+pending_id+'.json')
        pending_before=json.loads(pending_file.read_text('utf8'));details['pendingBeforeRestart']=pending_before
        checks['real-native-accepted-at-shutdown']=pending_before['status']=='accepted' and pending_before['dispatched'] is True and pending_before['requestId']==pending_id
        assert checks['real-native-accepted-at-shutdown'],pending_before
        pending_sha=sha(pending_file)
        run([*base,'start','mc'],timeout=60);restart=boot();details['restartInitial']=restart
        old_success=query(success_id);old_fail=query(failed_id);unknown=query(pending_id);repeat_unknown=submit(pending_id)
        for row,rid in ((old_success,success_id),(old_fail,failed_id),(unknown,pending_id),(repeat_unknown,pending_id)):identity(row,rid)
        details['afterRestartReceipts']={'success':old_success,'failure':old_fail,'pending':unknown,'pendingRepeated':repeat_unknown}
        checks['completed-results-survive-restart-with-original-epoch']=stable(old_success)==stable(success) and stable(old_fail)==stable(failed)
        checks['interrupted-native-request-never-replayed']=unknown['status']=='unknown' and unknown['code']=='native_runtime_interrupted' and repeat_unknown['status']=='unknown' and repeat_unknown['code']=='native_runtime_interrupted' and sha(pending_file)==pending_sha
        restored=response('qdinteractionqa restore');assert restored['ok'],restored
        after_restart=ground();details['restoredObservation']=after_restart
        checks['restart-query-never-consumes-or-recreates-items']=after_restart['dirt']==7 and after_restart['placementBlock']=='minecraft:air' and after_restart['registryCount']==1 and after_restart['rosterCount']==1
        checkpoint('restart-idempotency-verified')
        for mode in ('normal','lost-ack'):
            before_python=ground()
            assert before_python['placementBlock']=='minecraft:air',before_python
            output=run([*base,'run','--rm','--no-deps','-T','python-qa',mode],timeout=75)
            client=json.loads(output.stdout.strip())
            details['python-'+mode]=client
            after_python=ground();client['before']=before_python;client['after']=after_python
            commands=client['commands'];request=client['actionId'];reply=client.get('result') or {}
            receipt=reply.get('data',{}).get('nativeInteractionReceipt',{})
            checks['python-'+mode+'-native-terminal']=client['error'] is None and reply.get('success') is True and receipt.get('status')=='terminal' and receipt.get('requestId')==request
            checks['python-'+mode+'-single-dispatch']=len(commands)>=2 and commands[0].startswith(f'qdworld interact {BODY} {request} ') and all(c==f'qdworld interaction {BODY} {request}' for c in commands[1:])
            checks['python-'+mode+'-consumes-once']=after_python['dirt']==before_python['dirt']-1 and after_python['placementBlock']=='minecraft:dirt'
            assert all(checks[name] for name in checks if name.startswith('python-'+mode)),client
            observed=[r['receipt'] for r in client['responses'] if r['receipt'] is not None]
            checks['python-'+mode+'-actual-accepted-to-terminal']=len(observed)>=2 and observed[0]['status']=='accepted' and observed[-1]['status']=='terminal'
            assert checks['python-'+mode+'-actual-accepted-to-terminal'],client
            removed=response('qdinteractionqa remove_placed');assert removed['ok'],removed
            same=query(request);after_query=ground()
            checks['python-'+mode+'-exact-receipt-no-extra-effect']=stable(same)==stable(receipt) and after_query['placementBlock']=='minecraft:air' and after_query['dirt']==after_python['dirt']
            checkpoint('python-'+mode+'-verified')
    except Exception as error:
        checks['execution-completed']=False;details['failure']=str(error)[:5000]
    finally:
        (folder/'server-final.log').write_text(run([*base,'logs','--no-color'],check=False).stdout,'utf8')
        stopped=run([*base,'down','--timeout','60'],timeout=120,check=False)
        checks['isolated-services-removed']=stopped.returncode==0 and not run([*base,'ps','-a','-q'],check=False).stdout.strip()
    report={'ok':all(checks.values()),'checks':checks,'details':details,'candidateSha256':build['sha256'],'candidateSources':build['sources'],
            'project':project,'fixtureSourceSha256':sha(SOURCE),'toolSha256':sha(Path(__file__)),'numenSha256':record['numenSha256'],
            'pythonIntegration':python_record,
            'modCount':len(record['modSources']),'modelCalls':0,'productionMutations':0,'elapsedSeconds':round(time.monotonic()-began,2),
            'scope':'Fresh isolated world, actual Numen task/vanilla placement and persisted bridge receipts; installed mod snapshots, no production save or model.'}
    write(folder/'result.json',report)
    print(json.dumps({'ok':report['ok'],'checks':checks,'report':str(folder/'result.json')}),flush=True)
    return 0 if report['ok'] else 1


if __name__=='__main__':raise SystemExit(main())
