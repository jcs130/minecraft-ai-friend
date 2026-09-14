"""Actual loaded geometry / native defense observation in a fresh private modded world."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import time

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'world/irons-bridge-src/qa/NavigationSenseQa.java'
BODY='d4ac9523-4962-43ed-98c5-19b49e104048'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-isolated',action='store_true',required=True)
    args=parser.parse_args()
    spec=importlib.util.spec_from_file_location('navigation_sense_isolation',ROOT/'tools/smoke_world_interaction.py')
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    helper.SOURCE=SOURCE
    folder=helper.prepare();record=json.loads((folder/'prepared.json').read_text('utf8'))
    candidate=helper.DEFAULT_JAR;build=json.loads(candidate.with_name('build-record.json').read_text('utf8'))
    assert build['ok'] and build['sha256']==helper.sha(candidate)
    assert all(helper.sha(ROOT/name)==digest for name,digest in build['sources'].items())
    installed=list((folder/'data/mods').glob('qiandeng-irons-bridge-*.jar'));assert len(installed)==1
    shutil.copyfile(candidate,installed[0]);assert helper.sha(installed[0])==build['sha256']
    base=['docker','compose','-p',record['project'],'-f',str(folder/'compose.json')]
    def command(text):return helper.run([*base,'exec','-T','mc','rcon-cli',text],timeout=35).stdout
    def response(text,prefix='QD_NAVIGATION_QA '):
        raw=command(text)
        if prefix not in raw:raise ValueError('native_reply_missing:'+raw[-200:])
        return json.JSONDecoder().raw_decode(''.join(raw.split(prefix,1)[1].splitlines()))[0]
    def sense(target=''):
        return response('qdworld navigation_sense '+BODY+(' '+target if target else ''),'QD_NAVIGATION_SENSE_JSON ')
    details={};checks={};began=time.monotonic()
    try:
        helper.run([*base,'up','-d','mc'],timeout=60)
        deadline=time.monotonic()+420;last_notice=0
        while time.monotonic()<deadline:
            result=helper.run([*base,'exec','-T','mc','rcon-cli','list'],check=False,timeout=30)
            if result.returncode==0 and 'players online' in result.stdout:break
            if time.monotonic()-last_notice>25:
                print(json.dumps({'stage':'waiting-isolated-server','seconds':round(time.monotonic()-began)}),flush=True);last_notice=time.monotonic()
            time.sleep(2)
        else:raise TimeoutError('isolated_server_start_timeout')
        setup=response('qdnavqa setup');assert setup['ok'];time.sleep(1)
        details['before']=response('qdnavqa status');details['idle']=sense()
        checks['exact-body-native-scheduler-read']=details['idle'].get('actorUuid')==BODY and details['idle']['bodyControl']['available'] and details['idle']['bodyControl']['kind']=='idle'
        table=sense('3 -60 0');details['table']=table;dest=table['destination']
        checks['table-target-blocked-original-kept']=dest['targetBlock']=='minecraft:crafting_table' and dest['code']=='target_body_collision' and dest['requested']=={'x':3.,'y':-60.,'z':0.} and dest['destinationChanged'] is False
        farm=sense('2 -60 0');details['farmland']=farm
        checks['farmland-real-fractional-support']=any(c['supportBlock']=='minecraft:farmland' and c['y']==-60.0625 for c in farm['destination']['candidates'])
        height=sense('0 -59 0');details['wrong-height']=height
        checks['height-error-suggests-ground']=height['destination']['code']=='requested_height_unsupported' and any(c['y']==-60 for c in height['destination']['candidates'])
        water=sense('4 -60 0');details['water']=water
        checks['fluid-target-not-dry']=water['destination']['code']=='target_contains_fluid' and not water['destination']['requestedStanceSupported']
        before=response('qdnavqa status');far=sense('10000 -60 10000');after=response('qdnavqa status');details['far']={'before':before,'sense':far,'after':after}
        checks['no-distant-chunk-load']=not far['destination']['available'] and far['destination']['code']=='target_outside_local_survey' and before['chunkCount']==after['chunkCount']
        checks['observations-never-move-body']=all(abs(details['before'][k]-after[k])<.001 for k in ('x','y','z'))
        assert response('qdnavqa danger')['ok']
        samples=[];deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            value=sense();samples.append(value)
            if value['bodyControl'].get('nativeAvoidanceActive'):break
            time.sleep(.1)
        details['actual-native-defense']=samples
        checks['native-defense-holder-observed']=any(v['bodyControl'].get('kind')=='reflex' and v['bodyControl'].get('name')=='mob_defense' and v['bodyControl'].get('nativeAvoidanceActive') is True for v in samples)
        assert response('qdnavqa clear_danger')['ok'];time.sleep(3)
        details['after-defense']=sense()
        checks['cleared-danger-stops-reporting-active']=not details['after-defense']['bodyControl'].get('nativeAvoidanceActive')
        checks['bounded-loaded-local-geometry']=all(v['destination']['examinedCells']==125 and len(v['destination']['candidates'])<=5 and not v['destination']['pathVerified'] for v in (table,farm,height,water))
    except Exception as error:
        checks['execution-completed']=False;details['error']=str(error)[:2000]
    finally:
        (folder/'server-final.log').write_text(helper.run([*base,'logs','--no-color'],check=False).stdout,'utf8')
        stopped=helper.run([*base,'down','--timeout','60'],timeout=120,check=False)
        checks['isolated-services-removed']=stopped.returncode==0 and not helper.run([*base,'ps','-a','-q'],check=False).stdout.strip()
    report={'ok':all(checks.values()),'checks':checks,'details':details,'candidateSha256':build['sha256'],'candidateSources':build['sources'],
        'fixtureSourceSha256':helper.sha(SOURCE),'toolSha256':helper.sha(Path(__file__)),'numenSha256':record['numenSha256'],
        'modCount':len(record['modSources']),'productionMutations':0,'modelCalls':0,'project':record['project'],'elapsedSeconds':round(time.monotonic()-began,2)}
    helper.write(folder/'result.json',report)
    print(json.dumps({'ok':report['ok'],'checks':checks,'report':str(folder/'result.json')}),flush=True)
    return 0 if report['ok'] else 1

if __name__=='__main__':raise SystemExit(main())
