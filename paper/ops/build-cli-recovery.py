"""Build read-only command recovery over the reviewed AF 0.4.47.46; never install."""
from pathlib import Path
import argparse,copy,hashlib,json,os,subprocess,zipfile

p=argparse.ArgumentParser(description=__doc__)
for name in ['server','jdk','output']:p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();paper=Path(__file__).resolve().parents[1];root=paper/'plugins/AgentFriend'
base=a.server/'plugins/AgentFriend-0.4.47.46-rpg.jar';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(base)=='a91218587aa1d759f06346b13d81aa3a08f22b0a510ddfc4a53294bcb0cf7bf2'
out=a.output.resolve();assert not out.exists()and not out.is_relative_to(a.server.resolve());out.mkdir(parents=True)
classes=out/'classes';classes.mkdir();empty=out/'empty';empty.mkdir()
names=['AgentCliRecovery','AgentCliRecoveryService','CommandEmbeddingIndex','AgentCliCatalog','AgentCliText','AgentCommunication','AgentFriendPlugin','NativeRpg','SiteDungeonManager']
sources=[root/f'src/org/afuhome/agentfriend/{name}.java'for name in names]
bridge=paper/'integrations/vortex-rpg/src/org/qiandengji/vortex/VortexBridge.java';sources.append(bridge)
rpg_base=a.server/'plugins/QiandengjiRpg-0.2.10.jar';assert sha(rpg_base)=='59d709ce193af078810d6efee795ed4aee56792e552e35259f83ed69f442fd24'
tests=['AgentCliRecoveryTest','AgentCliContractTest','AgentCliTextTest','NativeCliCatalogTest','ProtectionGuidanceTest']
test_sources=[root/f'tests/org/afuhome/agentfriend/{name}.java'for name in tests]
test_sources.append(paper/'integrations/vortex-rpg/src/org/qiandengji/vortex/SkillTransition.java')
dependencies=[base,*a.server.glob('libraries/**/*.jar'),*a.server.glob('plugins/*.jar')];cp=os.pathsep.join(map(str,dependencies))
values=['-proc:none','-implicit:none','-encoding','UTF-8','--release','21','-sourcepath',str(empty),'-cp',cp,'-d',str(classes),*map(str,sources+test_sources)]
argfile=out/'compile.args';argfile.write_text('\n'.join('"'+x.replace('\\','/')+'"'for x in values),encoding='utf-8')
with(out/'compile.log').open('wb')as log:compiled=subprocess.run([str(a.jdk/'bin/javac.exe'),'@'+str(argfile)],stdout=log,stderr=subprocess.STDOUT)
if compiled.returncode:raise SystemExit('Compilation failed; inspect compile.log')
for name in tests:
    with(out/(name+'.log')).open('wb')as log:checked=subprocess.run([str(a.jdk/'bin/java.exe'),'-ea','-cp',str(classes)+os.pathsep+cp,'org.afuhome.agentfriend.'+name,str(root/'resources')],stdout=log,stderr=subprocess.STDOUT,timeout=120)
    if checked.returncode:raise SystemExit('Test failed; inspect '+name+'.log')
def owned(name):return name.startswith('org/afuhome/agentfriend/')and name.endswith('.class')and name.rsplit('/',1)[-1].split('$')[0].removesuffix('.class')in names
updates={f.relative_to(classes).as_posix():f.read_bytes()for f in classes.rglob('*.class')if owned(f.relative_to(classes).as_posix())}
target=out/'AgentFriend-0.4.47.47-rpg.jar'
with zipfile.ZipFile(base)as before:
    descriptor=before.read('plugin.yml');assert descriptor.count(b'0.4.47.46-rpg')==1
    updates['plugin.yml']=descriptor.replace(b'0.4.47.46-rpg',b'0.4.47.47-rpg')
    assert {n for n in before.namelist()if owned(n)}<=set(updates)
    with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED)as after:
        for item in before.infolist():after.writestr(copy.copy(item),updates.get(item.filename,before.read(item.filename)))
        for name in sorted(set(updates)-set(before.namelist())):after.writestr(name,updates[name])
with zipfile.ZipFile(base)as before,zipfile.ZipFile(target)as after:
    changed=[n for n in before.namelist()if before.read(n)!=after.read(n)];added=sorted(set(after.namelist())-set(before.namelist()))
    assert not set(before.namelist())-set(after.namelist())and set(changed+added)<=set(updates)
def bridge_owned(name):return name.startswith('org/qiandengji/vortex/VortexBridge')and name.endswith('.class')and name.rsplit('/',1)[-1].split('$')[0].removesuffix('.class')=='VortexBridge'
bridge_updates={f.relative_to(classes).as_posix():f.read_bytes()for f in classes.rglob('*.class')if bridge_owned(f.relative_to(classes).as_posix())};rpg_target=out/'QiandengjiRpg-0.2.17.jar'
with zipfile.ZipFile(rpg_base)as before:
    descriptor=before.read('plugin.yml');assert descriptor.count(b'0.2.16')==1
    bridge_updates['plugin.yml']=descriptor.replace(b'0.2.16',b'0.2.17')
    assert {n for n in before.namelist()if bridge_owned(n)}<=set(bridge_updates)
    with zipfile.ZipFile(rpg_target,'x',zipfile.ZIP_DEFLATED)as after:
        for item in before.infolist():after.writestr(copy.copy(item),bridge_updates.get(item.filename,before.read(item.filename)))
        for name in sorted(set(bridge_updates)-set(before.namelist())):after.writestr(name,bridge_updates[name])
with zipfile.ZipFile(rpg_base)as before,zipfile.ZipFile(rpg_target)as after:
    bridge_changed=[n for n in before.namelist()if before.read(n)!=after.read(n)];assert not set(before.namelist())-set(after.namelist())and set(bridge_changed)<=set(bridge_updates)
    bridge_preserved=len(before.namelist())-len(bridge_changed)
receipt={'artifact':target.name,'sha256':sha(target),'baselineSha256':sha(base),'sources':{str(f.relative_to(paper)):sha(f)for f in sources},'changedEntries':changed,'addedEntries':added,'otherEntriesPreserved':len(zipfile.ZipFile(base).namelist())-len(changed),'productionChanged':False,'tests':tests,'neuralLookupProductionEnabled':False,'rpgCompanion':{'artifact':rpg_target.name,'sha256':sha(rpg_target),'baselineSha256':sha(rpg_base),'version':'0.2.17','changedEntries':bridge_changed,'otherEntriesPreserved':bridge_preserved}}
(out/'build.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))
