"""Patch the pinned OlEncounters async call; preserve every other implementation entry."""
from pathlib import Path
import argparse,copy,hashlib,json,os,subprocess,zipfile
p=argparse.ArgumentParser(description=__doc__)
for key in ['server','jdk','output']:p.add_argument('--'+key,type=Path,required=True)
a=p.parse_args();root=Path(__file__).parent;base=a.server/'plugins/OlEncounters-1.7.0.jar'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(base)=='1577935cc738f199719db7c1b4eaa1630a4ecaa208aba5f5d18943585075ab0f'
out=a.output.resolve();assert not out.exists()and not out.is_relative_to(a.server.resolve());out.mkdir(parents=True)
classes=out/'classes';classes.mkdir();asm=a.server/'libraries/org/ow2/asm/asm/9.10.1/asm-9.10.1.jar';assert asm.is_file()
cp=os.pathsep.join(map(str,[base,asm,*a.server.glob('libraries/**/*.jar'),*a.server.glob('plugins/*.jar')]))
options=['--release','21','-proc:none','-encoding','UTF-8','-cp',cp,'-d',str(classes),str(root/'src/com/olencounters/compat/YouerChunks.java'),str(root/'patches/YouerChunkCallPatch.java')]
argfile=out/'compile.args';argfile.write_text('\n'.join('"'+s.replace('\\','/')+'"'for s in options),encoding='utf-8')
with(out/'compile.log').open('wb')as log:compiled=subprocess.run([str(a.jdk/'bin/javac.exe'),'@'+str(argfile)],stdout=log,stderr=subprocess.STDOUT)
assert compiled.returncode==0,'OlEncounters bridge compile failed; inspect compile.log'
name='com/olencounters/location/LocationFinder.class'
with zipfile.ZipFile(base)as jar:(out/'LocationFinder.before.class').write_bytes(jar.read(name))
with(out/'patch.log').open('wb')as log:patched=subprocess.run([str(a.jdk/'bin/java.exe'),'-cp',str(classes)+os.pathsep+str(asm),'YouerChunkCallPatch',str(out/'LocationFinder.before.class'),str(out/'LocationFinder.class')],stdout=log,stderr=subprocess.STDOUT)
assert patched.returncode==0,'Pinned bytecode call did not match'
updates={name:(out/'LocationFinder.class').read_bytes()}
updates.update({f.relative_to(classes).as_posix():f.read_bytes()for f in(classes/'com/olencounters/compat').rglob('*.class')})
target=out/'OlEncounters-1.7.0-qd-youer1.jar'
with zipfile.ZipFile(base)as before:
 descriptor=before.read('plugin.yml');assert descriptor.count(b"version: '1.7.0'")==1 or descriptor.count(b'version: 1.7.0')==1
 updates['plugin.yml']=descriptor.replace(b"version: '1.7.0'",b"version: '1.7.0-qd-youer1'").replace(b'version: 1.7.0\n',b'version: 1.7.0-qd-youer1\n')
 assert updates['plugin.yml']!=descriptor
 with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED)as after:
  for entry in before.infolist():after.writestr(copy.copy(entry),updates.get(entry.filename,before.read(entry.filename)))
  for key in sorted(set(updates)-set(before.namelist())):after.writestr(key,updates[key])
with zipfile.ZipFile(base)as before,zipfile.ZipFile(target)as after:
 changed=[n for n in before.namelist()if before.read(n)!=after.read(n)];added=sorted(set(after.namelist())-set(before.namelist()))
 assert set(changed+added)<=set(updates)and not set(before.namelist())-set(after.namelist())
 proof={'baselineSha256':sha(base),'sha256':sha(target),'changedEntries':changed,'addedEntries':added,'otherEntriesPreserved':len(before.namelist())-len(changed),'productionChanged':False}
(out/'build.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof))
