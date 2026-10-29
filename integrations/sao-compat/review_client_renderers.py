"""Retain failed render-only mods in the client and quarantine server copies."""
import argparse
import json
import os
from pathlib import Path
from prepare_pack import digest

REVIEWED = {
    "lootbeams-1.20.1-1.2.6.jar": "LootBeams constructor loads client rendering classes; no dedicated-server entrypoint",
    "mekalus-mc1.20.1-1.8.0.1.jar": "Oculus/Iris shader renderer entrypoint net.irisshaders.iris.Iris loads client Screen",
}
REVIEWED_HASHES = {
    "lootbeams-1.20.1-1.2.6.jar": "4660197524c9198ca93b20999204881a007df452e3bd2151358ea6b844e86b3f",
    "mekalus-mc1.20.1-1.8.0.1.jar": "413fd1cd450cb1b3682651e505db0978fd688cc718a02d306ef5cbc93bc01eec",
}

def apply(root, evidence=None):
    root=Path(root).resolve(strict=True)
    if json.loads((root/'pack-source.json').read_text('utf-8')).get('scope')!='isolated_testing':raise ValueError('Not an isolated lab')
    state=root/'lab-process.json'
    if state.exists() and json.loads(state.read_text('utf-8'))['phase']!='exited':raise ValueError('JVM must have exited')
    evidence=Path(evidence).resolve(strict=True)if evidence else None
    if evidence:
        text=evidence.read_text('utf-8',errors='replace')
        if 'LootBeams' not in text or 'oculus' not in text or 'DEDICATED_SERVER' not in text:raise ValueError('Reviewed constructor failure evidence changed')
    plan=json.loads((root/'server-export.json').read_text('utf-8'))
    quarantine=root/'excluded-client-only'
    quarantine.mkdir(exist_ok=True)
    records=[]
    for name,reason in REVIEWED.items():
        source=(root/'server/mods'/name).resolve()
        target=(quarantine/name).resolve()
        if not source.is_relative_to(root/'server/mods') or not target.is_relative_to(quarantine):raise ValueError('Unexpected file scope')
        row=next(item for item in plan['mods'] if item['filename']==name)
        if row['sha256']!=REVIEWED_HASHES[name]:raise ValueError('Review another renderer build')
        original=root/'client/mods'/name
        if digest(original)!=row['sha256']:raise ValueError('Client bytes changed')
        if source.exists():
            if digest(source)!=row['sha256'] or target.exists():raise ValueError('Review unexpected server/quarantine bytes')
            os.replace(source,target)
        if digest(target)!=row['sha256']:raise ValueError('Quarantined content differs')
        records.append({'filename':name,'sha256':row['sha256'],'reason':reason,'client_preserved':True})
    (root/'confirmed-client-renderers.json').write_text(json.dumps({'evidence':str(evidence)if evidence else 'reviewed exact artifact hashes; incident 2026-10-29 13:21:35','evidence_sha256':digest(evidence)if evidence else None,'excluded':records},indent=2),encoding='utf-8')
    print(json.dumps(records,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,required=True);parser.add_argument('--evidence');args=parser.parse_args();apply(args.root,args.evidence)
