"""Record verified installed bytes and existing live receipts, without secrets."""
import argparse
from datetime import datetime,timezone
import json
import re
from pathlib import Path
import xml.etree.ElementTree as ET
from prepare_pack import digest

def record(root, output):
    root=Path(root).resolve(strict=True)
    read=lambda p:json.loads((root/p).read_text('utf-8'))
    marker=read('pack-source.json')
    if marker['scope']!='isolated_testing':raise ValueError('marked_lab_required')
    process=read('lab-process.json');registry=read('server/maw-sao/registry/current.json')
    if process['phase']!='ready' or process['pid']!=registry['processId']:raise ValueError('current_jvm_not_ready')
    plan={r['filename']:r for r in read('server-export.json')['mods']}
    fixes={
        'vzling-0.98.7-1.20.1-forge.jar':'vzling-server-fix.json',
        'ftb-teams-forge-2001.3.2.jar':'teams-server-fix.json',
        'numen-forge-1.20.1-0.1.4.1-all.jar':'numen-quests-server-fix.json',
    }
    inventory=[]
    for file in sorted((root/'server/mods').glob('*.jar'),key=lambda p:p.name.casefold()):
        sha=digest(file)
        if file.name in fixes:
            expected=read(fixes[file.name])['patched_sha256'];source=fixes[file.name]
        elif file.name=='maw-sao-native-0.1.0.jar':
            expected=digest(root/'native-addon-build/build/libs'/file.name);source='self_built_forge_addon'
        elif file.name in plan:
            expected=plan[file.name]['sha256'];source='author_pack_verified_original'
        else:raise ValueError('unreviewed_installed_mod:'+file.name)
        if sha!=expected:raise ValueError('installed_bytes_changed:'+file.name)
        inventory.append({'filename':file.name,'sha256':sha,'bytes':file.stat().st_size,'source':source})
    if len(inventory)!=173:raise ValueError('installed_count_changed')
    state=read('acceptance/get_state-latest.json')
    sampled=datetime.fromisoformat(state['sampledAt'].replace('Z','+00:00'))
    if (datetime.now(timezone.utc)-sampled).total_seconds()>120:raise ValueError('query_fresh_numen_state_before_recording')
    if not state.get('online')or state.get('blocked'):raise ValueError('numen_body_not_ready')
    native=read('native-probe.json')
    ready=next(v['result']for v in native if v['kind']=='ready')
    if ready['epoch']!=registry['serverEpoch']:raise ValueError('native_probe_epoch_changed')
    absent=any(v['kind']=='numen_client_absent' and v['result']['clientModInstalled']is False for v in native)
    if not absent or any(v['kind']in {'error','not_ready','probe_error','end'}for v in native):raise ValueError('native_optional_client_not_verified')
    live=next(v for v in reversed(native)if v['kind']=='snapshot')
    if (datetime.now(timezone.utc)-datetime.fromisoformat(live['observedAt'].replace('Z','+00:00'))).total_seconds()>120 or not live['result'].get('ok'):raise ValueError('query_fresh_native_snapshot_before_recording')
    security=read('acceptance/security.json')
    if len(security)!=7 or not all(r['passed']for r in security):raise ValueError('security_acceptance_incomplete')
    junit=root/'acceptance/node-tests.xml';python_log=root/'acceptance/python-tests.log'
    suite=ET.parse(junit).getroot()
    if len(suite.findall('.//testcase'))!=26 or suite.findall('.//failure')or suite.findall('.//error'):raise ValueError('node_test_report_incomplete')
    pytext=python_log.read_text('utf-8')
    if not re.search(r'Ran 2 tests',pytext)or not re.search(r'(?m)^OK$',pytext):raise ValueError('python_test_report_incomplete')
    pot=read('acceptance/mineflayer-native-pot-first-run.json')
    walk=next(v['result']for v in pot if v['kind']=='walk')
    opened=next(v['result']['menu']for v in pot if v['kind']=='open')
    last=next(v['result']['menu']for v in reversed(pot)if v['kind']=='snapshot')
    carrots=lambda menu:sum(v['count']for v in menu['slots']if v and v['id']=='minecraft:carrot')+(menu.get('carried')or{}).get('count',0)
    if opened['menuType']!='farmersdelight:cooking_pot' or carrots(opened)!=8 or carrots(last)!=8:raise ValueError('native_pot_inventory_not_verified')
    stop=read('acceptance/action_status-numen-stop-001.json')
    if stop['phase']!='terminal' or stop['ok']is not False or stop['outcome']['status']!='stopped' or stop['after']['programRunning']:raise ValueError('stop_receipt_not_verified')
    result={
        'schemaVersion':1,'observedAt':datetime.now(timezone.utc).isoformat(),'scope':'isolated_testing',
        'minecraft':'1.20.1','forge':'47.4.10','numen':'0.1.4.1','packSha256':marker['sha256'],
        'installedJarCount':len(inventory),'installedMods':inventory,'registry':{k:registry[k]for k in ['states','items','entities']},
        'verified':{'numenOnline':True,'numenOriginalBodyId':state['bodyId'],'numenPosition':state['position'],
          'numenStopTerminal':True,'mineflayerConnectedPlayerUuid':ready['uuid'],'numenClientAbsent':True,
          'nativeOperationCount':len(ready['operations']),'nativePotMenu':opened['menuType'],
          'nativeCarrotsBefore':8,'nativeCarrotsAfter':8,'walkBefore':walk['before']['position'],'walkAfter':walk['after']['position'],
          'securityChecks':len(security)},
        'sourceTests':{'newNode':9,'sharedNativeClient':17,'python':2},
        'testReportSha256':{'nodeJUnit':digest(junit),'pythonLog':digest(python_log)},
        'productionModified':False,'publicAccessEnabled':False,'allModsVerified':False,
        'pending':['native_recipes_and_auto_craft','mod_mana_skills_and_cooldowns','full_combat_and_quest_coverage','java_full_ui','web_and_bedrock_rendering','remote_registry_distribution','long_run_chunk_save_stability'],
    }
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'recorded':True,'installedJars':len(inventory),'sourceTests':28,'securityChecks':7,'allModsVerified':False}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);p.add_argument('--output',required=True);a=p.parse_args();record(a.root,a.output)
