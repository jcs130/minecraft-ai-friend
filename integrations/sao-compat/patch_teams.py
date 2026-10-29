"""Exact, server-only fix for SAO's added client UUID helper, not upstream Teams."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import zipfile
from prepare_pack import digest

def patch(root):
    root=Path(root).resolve(strict=True)
    marker=json.loads((root/'pack-source.json').read_text('utf-8'))
    if marker.get('scope')!='isolated_testing' or marker['sha256']!='707f8a9db948a9ad5855b28246ec46738a9a7fe953ed30d0531e4291967360bd':
        raise ValueError('review_another_pack')
    if json.loads((root/'lab-process.json').read_text('utf-8'))['phase']!='exited':
        raise ValueError('stop_owned_lab_before_patch')
    name='ftb-teams-forge-2001.3.2.jar'
    source=root/'client/mods'/name;target=root/'server/mods'/name
    plan=json.loads((root/'server-export.json').read_text('utf-8'))
    expected=next(r['sha256']for r in plan['mods'] if r['filename']==name)
    report=root/'teams-server-fix.json'
    if report.exists() and digest(target)==json.loads(report.read_text('utf-8'))['patched_sha256']:
        print('already_applied');return
    if digest(source)!=expected or digest(target)!=expected:raise ValueError('source_or_server_changed')
    java=Path(json.loads((root/'runtime-lock.json').read_text('utf-8'))['java']['java'])
    asm=root/'server/libraries/org/ow2/asm/asm/9.8/asm-9.8.jar';tree=root/'server/libraries/org/ow2/asm/asm-tree/9.8/asm-tree-9.8.jar'
    cp=os.pathsep.join(map(str,(asm,tree)));work=root/'build/teams-server-fix';work.mkdir(parents=True,exist_ok=True)
    helper=Path(__file__).with_name('PatchTeamClientHelper.java')
    subprocess.run([str(java.with_name('javac.exe')),'--release','17','-cp',cp,'-d',str(work),str(helper)],check=True)
    entry='dev/ftb/mods/ftbteams/data/ClientTeamManagerImpl.class'
    with zipfile.ZipFile(source)as before:
        if any(n.upper().startswith('META-INF/') and n.upper().endswith(('.SF','.RSA','.DSA')) for n in before.namelist()):raise ValueError('signed_artifact')
        original=work/'original.class';original.write_bytes(before.read(entry));modified=work/'server.class'
        subprocess.run([str(java),'-cp',os.pathsep.join((str(work),cp)),'PatchTeamClientHelper',str(original),str(modified)],check=True)
        temp=target.with_suffix('.jar.compat-part')
        with zipfile.ZipFile(temp,'w')as output:
            for info in before.infolist():output.writestr(info,modified.read_bytes() if info.filename==entry else before.read(info))
    with zipfile.ZipFile(source)as before,zipfile.ZipFile(temp)as after:
        changed=[n for n in before.namelist()if before.read(n)!=after.read(n)]
        if after.testzip() or before.namelist()!=after.namelist() or changed!=[entry]:raise ValueError('unexpected_jar_changes')
    record={'original_sha256':expected,'patched_sha256':digest(temp),'changed_entries':changed,'method':'saoConnectedPlayerId','server_only':True,'client_original_preserved':True,'teams_and_quests_retained':True,'reason':'pack-added client-only helper links LocalPlayer while JVM verifies common team sync class','helper_sha256':digest(helper)}
    os.replace(temp,target);report.write_text(json.dumps(record,indent=2),encoding='utf-8');print(json.dumps(record))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);patch(p.parse_args().root)
