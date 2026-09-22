"""Read current scheduler evidence for the exact body; never scan, move, or call a model."""
import json
from pathlib import Path
import re
import subprocess
import time

from world_interaction_health import (ROOT, JAR, BUILD_JAR, BUILD_RECORD, MANIFEST,
    SETTINGS, CONFIG, NUMEN, canonical, digest, document)

PREFIX='QD_NAVIGATION_SENSE_JSON '
REQUIRED_SOURCES={'tools/build_irons_bridge.py',
    'world/irons-bridge-src/src/dev/qiandeng/irons/QiandengIronsBridge.java',
    'world/irons-bridge-src/src/dev/qiandeng/irons/WorldNavigationSense.java'}


def read_status(body):
    if not canonical(body):raise ValueError('invalid_body_identity')
    result=subprocess.run(['docker','exec','qiandengji-mc-1','rcon-cli',
        'qdworld navigation_sense '+body],capture_output=True,text=True,encoding='utf8',errors='replace',timeout=12,check=False)
    if result.returncode:raise ValueError('native_query_unavailable')
    raw=re.sub(r'\x1b\[[0-9;]*m','',result.stdout)
    if len(raw.encode('utf8'))>10000 or raw.count(PREFIX)!=1:raise ValueError('native_reply_invalid')
    return json.JSONDecoder().raw_decode(''.join(raw.split(PREFIX,1)[1].splitlines()).strip())[0]


def probe(root=ROOT,sample=read_status,clock=time.time):
    checks=dict.fromkeys(('artifact_matches_build_and_manifest','source_current','pinned_numen_dependency',
        'exact_body_binding','native_protocol','current_scheduler_sample'),False)
    evidence={'queries':0,'geometryScans':0}
    try:
        record=document(root,BUILD_RECORD);manifest=document(root,MANIFEST);installed=digest(root,JAR)
        rows=[r for r in manifest['files'] if r.get('path')==JAR]
        checks['artifact_matches_build_and_manifest']=(record.get('ok') is True and manifest.get('schema_version')==1
            and len(rows)==1 and installed==record.get('sha256')==rows[0].get('sha256')==digest(root,BUILD_JAR))
        evidence['artifactSha256']=installed
        sources=record.get('sources')
        checks['source_current']=(isinstance(sources,dict) and REQUIRED_SOURCES<=set(sources) and len(sources)<=100
            and all(digest(root,name)==value for name,value in sources.items()))
        checks['pinned_numen_dependency']=record.get('dependencies',{}).get(Path(NUMEN).name)==digest(root,NUMEN)
    except (OSError,ValueError,TypeError,KeyError,AttributeError):pass
    try:
        settings=document(root,SETTINGS);config=document(root,CONFIG)
        expected={k:settings[k] for k in ('bodyUuid','ownerUuid','bodyName')}
        checks['exact_body_binding']=(canonical(expected['bodyUuid']) and canonical(expected['ownerUuid'])
            and config.get('schema')==1 and config.get('enabled') is True and config.get('bodies')==[expected])
        if checks['exact_body_binding']:
            evidence.update(queries=1,bodyUuid=expected['bodyUuid']);row=sample(expected['bodyUuid'])
            control=row.get('bodyControl') or {}
            at=row.get('observedAt');dim=settings.get('dimension','minecraft:overworld')
            checks['native_protocol']=(row.get('schema')==1 and row.get('capability')=='numen_navigation_sense_v1'
                and row.get('ok') is True and row.get('actorUuid')==expected['bodyUuid'] and row.get('dimension')==dim
                and type(at) is int and -5<=clock()-at/1000<=15
                and all(type(row.get(k)) is int and row[k]>=0 for k in ('gameTime','bodyTickCount')))
            checks['current_scheduler_sample']=(checks['native_protocol'] and control.get('available') is True
                and control.get('sample')=='last_native_scheduler_selection'
                and control.get('kind') in ('reflex','background_task','synchronous_task','idle_pose','idle')
                and isinstance(control.get('name'),str) and bool(re.fullmatch(r'[A-Za-z0-9_:-]{1,80}',control['name']))
                and type(control.get('nativeAvoidanceActive')) is bool
                and control['nativeAvoidanceActive']==(control['kind']=='reflex' and control['name']=='mob_defense'))
            evidence.update(observedAt=at,dimension=row.get('dimension'),gameTime=row.get('gameTime'),
                bodyTickCount=row.get('bodyTickCount'),bodyControl=control,queuedTask=row.get('queuedTask'))
    except (OSError,ValueError,TypeError,KeyError,AttributeError,subprocess.SubprocessError):pass
    return {'ok':all(checks.values()),'checks':checks,'evidence':evidence,'modelRequests':0,'worldActions':0,
        'scope':'Current exact body scheduler sample and installed source/artifact provenance. No geometry scan or historical movement inference.'}


check=probe
if __name__=='__main__':
    value=probe();print(json.dumps(value,ensure_ascii=True));raise SystemExit(0 if value['ok'] else 1)
