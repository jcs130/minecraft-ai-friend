"""Build pinned NPCSpeak and Youer persistence candidates, without installation."""
from pathlib import Path
import argparse,hashlib,json,zipfile,subprocess,os,copy
p=argparse.ArgumentParser(description=__doc__)
for k in ('server','jdk','output'):p.add_argument('--'+k,type=Path,required=True)
a=p.parse_args();source=Path(__file__).resolve().parent;paper=source.parents[1];out=a.output.resolve()
assert not out.exists() and not out.is_relative_to(a.server.resolve());out.mkdir(parents=True)
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
npc=a.server/'plugins/NPCSpeak-1.0.jar';kernel=a.server/'libraries/net/neoforged/neoforge/21.1.252/neoforge-21.1.252-server.jar'
assert sha(npc)=='50a528809d2d3ef60bb0a2faccb09bdbd5d8550736a333334194a5dc83f73a7a'
assert sha(kernel)=='b04ce83d2ad61e0804953a11704bba6e3f14f952be1dbfb96e9d10ab2095e0f7'
classes=out/'classes';classes.mkdir();empty=out/'empty';empty.mkdir()
readiness=paper/'plugins/AgentFriend/src/org/afuhome/agentfriend/NpcEntityReadiness.java'
helper=out/'NpcEntityReadiness.java';helper.write_text(readiness.read_text(encoding='utf-8').replace('package org.afuhome.agentfriend;','package com.l299l.npcspeak.npc;'),encoding='utf-8')
cp=os.pathsep.join(map(str,[npc,*a.server.glob('libraries/**/*.jar')]))
args=['-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-sourcepath',str(empty),'-cp',cp,'-d',str(classes),str(helper),str(source/'src/com/l299l/npcspeak/npc/BuiltinNpcProvider.java'),str(source/'PatchLifecycle.java')]
af=out/'compile.args';af.write_text('\n'.join('"'+v.replace('\\','/')+'"' for v in args),encoding='utf-8')
r=subprocess.run([str(a.jdk/'bin/javac.exe'),'@'+str(af)],capture_output=True);(out/'compile.log').write_bytes(r.stdout+r.stderr)
if r.returncode:raise SystemExit('Compilation failed: '+str(out/'compile.log'))
receipts=[]
for jar,entry in [(npc,'com/l299l/npcspeak/npc/NpcManager.class'),(kernel,'net/minecraft/world/entity/Entity.class')]:
    with zipfile.ZipFile(jar) as z:before=z.read(entry)
    original=out/(jar.stem+'.original.class');original.write_bytes(before)
    patched=out/(jar.stem+'.patched.class')
    r=subprocess.run([str(a.jdk/'bin/java.exe'),'-cp',str(classes)+os.pathsep+cp,'PatchLifecycle',str(original),str(patched)],capture_output=True)
    (out/(jar.stem+'.patch.log')).write_bytes(r.stdout+r.stderr)
    if r.returncode:raise SystemExit('Bytecode patch failed: '+jar.name)
    updates={entry:patched.read_bytes()}
    if jar==npc:
        updates.update({f.relative_to(classes).as_posix():f.read_bytes() for f in classes.rglob('*.class') if f.relative_to(classes).as_posix().startswith('com/l299l/npcspeak/npc/')})
    target=out/jar.name
    with zipfile.ZipFile(jar) as z,zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED) as to:
        assert not any(n.upper().endswith(('.SF','.RSA','.DSA')) for n in z.namelist()),'signed artifact needs upstream rebuild'
        for item in z.infolist():to.writestr(copy.copy(item),updates.get(item.filename,z.read(item.filename)))
        for n in sorted(set(updates)-set(z.namelist())):to.writestr(n,updates[n])
    with zipfile.ZipFile(jar) as z,zipfile.ZipFile(target) as t:
        changed=[n for n in z.namelist() if z.read(n)!=t.read(n)]
        added=sorted(set(t.namelist())-set(z.namelist()))
        assert set(changed+added)<=set(updates) and not set(z.namelist())-set(t.namelist())
    receipts.append({'file':target.name,'sha256':sha(target),'baselineSha256':sha(jar),'changedEntries':changed,'addedEntries':added,'otherEntriesPreserved':len(z.namelist())-len(changed)})
receipt={'artifacts':receipts,'productionChanged':False,'requiresNormalRestart':True,'entitySaveWithoutIdUnchanged':True}
(out/'build.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))
