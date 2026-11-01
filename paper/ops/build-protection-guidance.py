"""Build configured protection directions over AF 0.4.47.45; never install."""
from pathlib import Path
import argparse,copy,hashlib,json,os,subprocess,zipfile

p=argparse.ArgumentParser(description=__doc__)
for name in ['server','jdk','output']:p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();paper=Path(__file__).resolve().parents[1];root=paper/'plugins/AgentFriend';base=a.server/'plugins/AgentFriend-0.4.47.45-rpg.jar';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(base)=='f889f73106754d1744d503dccf745911d2f24e1652869ea8f1d7d4a55aaab6c3'
out=a.output.resolve();assert not out.exists()and not out.is_relative_to(a.server.resolve());out.mkdir(parents=True);classes=out/'classes';classes.mkdir();empty=out/'empty';empty.mkdir()
names=['ProtectionAdvisor','ProtectionQuery','ProtectionChat'];sources=[root/f'src/org/afuhome/agentfriend/{name}.java'for name in names];test=root/'tests/org/afuhome/agentfriend/ProtectionGuidanceTest.java'
dependencies=[base,*a.server.glob('libraries/**/*.jar'),*a.server.glob('plugins/*.jar')];cp=os.pathsep.join(map(str,dependencies));values=['-proc:none','-implicit:none','-encoding','UTF-8','--release','21','-sourcepath',str(empty),'-cp',cp,'-d',str(classes),*map(str,sources),str(test)];argfile=out/'compile.args';argfile.write_text('\n'.join('"'+x.replace('\\','/')+'"'for x in values),encoding='utf-8')
with(out/'compile.log').open('wb')as log:subprocess.run([str(a.jdk/'bin/javac.exe'),'@'+str(argfile)],stdout=log,stderr=subprocess.STDOUT,check=True)
with(out/'protection-tests.log').open('wb')as log:subprocess.run([str(a.jdk/'bin/java.exe'),'-ea','-cp',str(classes)+os.pathsep+cp,'org.afuhome.agentfriend.ProtectionGuidanceTest'],stdout=log,stderr=subprocess.STDOUT,check=True)
def owned(name):return name.startswith('org/afuhome/agentfriend/')and name.endswith('.class')and name.rsplit('/',1)[-1].split('$')[0].removesuffix('.class')in names
updates={f.relative_to(classes).as_posix():f.read_bytes()for f in classes.rglob('*.class')if owned(f.relative_to(classes).as_posix())};target=out/'AgentFriend-0.4.47.46-rpg.jar'
with zipfile.ZipFile(base)as before:
 assert set(updates)=={n for n in before.namelist()if owned(n)};descriptor=before.read('plugin.yml');assert descriptor.count(b'0.4.47.45-rpg')==1;updates['plugin.yml']=descriptor.replace(b'0.4.47.45-rpg',b'0.4.47.46-rpg')
 with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED)as after:
  for item in before.infolist():after.writestr(copy.copy(item),updates.get(item.filename,before.read(item.filename)))
with zipfile.ZipFile(base)as before,zipfile.ZipFile(target)as after:
 changed=[n for n in before.namelist()if before.read(n)!=after.read(n)];assert set(before.namelist())==set(after.namelist())and set(changed)<=set(updates)
receipt={'artifact':target.name,'sha256':sha(target),'baselineSha256':sha(base),'sources':{str(f.relative_to(paper)):sha(f)for f in sources},'changedEntries':changed,'otherEntriesPreserved':len(before.namelist())-len(changed),'productionChanged':False};(out/'build.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))
