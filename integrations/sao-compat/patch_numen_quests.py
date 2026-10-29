"""Keep latest Numen; correct its server-side call to client-only FTB titles."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import zipfile
from prepare_pack import digest

def patch(root):
    root=Path(root).resolve(strict=True)
    if json.loads((root/'pack-source.json').read_text('utf-8'))['scope']!='isolated_testing':raise ValueError('marked_lab_required')
    if json.loads((root/'lab-process.json').read_text('utf-8'))['phase']!='exited':raise ValueError('stop_lab_before_patch')
    runtime=json.loads((root/'runtime-lock.json').read_text('utf-8'))
    source=Path(runtime['numen']['path']);target=root/'server/mods'/source.name
    expected='e8b95d53bc524cc5d4326edfcbedc76aa2ce9dee0fa5db2f30a962d4797c5ea4'
    report=root/'numen-quests-server-fix.json'
    if report.exists() and digest(target)==json.loads(report.read_text('utf-8'))['patched_sha256']:print('already_applied');return
    if digest(source)!=expected or digest(target)!=expected:raise ValueError('review_changed_numen_artifact')
    java=Path(runtime['java']['java']);work=root/'build/numen-quest-titles';work.mkdir(parents=True,exist_ok=True)
    cp=os.pathsep.join(str(root/p)for p in ['server/libraries/org/ow2/asm/asm/9.8/asm-9.8.jar','server/libraries/org/ow2/asm/asm-tree/9.8/asm-tree-9.8.jar'])
    helper=Path(__file__).with_name('PatchNumenQuestTitles.java')
    subprocess.run([str(java.with_name('javac.exe')),'--release','17','-cp',cp,'-d',str(work),str(helper)],check=True)
    patches={}
    with zipfile.ZipFile(source)as before:
        for name in ['QuestWatch','QuestSubmit']:
            entry='com/dwinovo/numen/plugins/ftbquests/'+name+'.class';original=work/(name+'.original.class');original.write_bytes(before.read(entry));modified=work/(name+'.server.class')
            subprocess.run([str(java),'-cp',os.pathsep.join((str(work),cp)),'PatchNumenQuestTitles',str(original),str(modified)],check=True);patches[entry]=modified.read_bytes()
        temp=target.with_suffix('.jar.compat-part')
        with zipfile.ZipFile(temp,'w')as out:
            for info in before.infolist():out.writestr(info,patches.get(info.filename,before.read(info)))
    with zipfile.ZipFile(source)as before,zipfile.ZipFile(temp)as after:
        changed=[n for n in before.namelist()if before.read(n)!=after.read(n)]
        if after.testzip() or before.namelist()!=after.namelist() or set(changed)!=set(patches):raise ValueError('unexpected_jar_changes')
    record={'original_sha256':expected,'patched_sha256':digest(temp),'changed_entries':changed,'changed_calls':6,'server_only':True,'requires':'maw_sao_native:FtbServerTitles','reason':'FTB QuestObjectBase.getTitle is stripped on dedicated servers; getRawTitle is retained and verified in the running JVM','numen_version':'0.1.4.1','source_commit':runtime['numen']['upstream_source_commit'],'helper_sha256':digest(helper)}
    os.replace(temp,target);report.write_text(json.dumps(record,indent=2),encoding='utf-8');print(json.dumps(record))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);patch(p.parse_args().root)
