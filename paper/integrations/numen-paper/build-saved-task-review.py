"""Overlay PR58's review boundary onto the pinned deployed Youer Numen API."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,zipfile
p=argparse.ArgumentParser(description=__doc__)
for name in ['server','jdk','output']:p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();r=Path(__file__).parent;out=a.output.resolve();out.mkdir(parents=True,exist_ok=False)
base=a.server/'plugins/numen_api-paper-1.21.1-0.1.4.jar'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(base)=='0240456e9b84cfa841c7384a3a368011a65f469bf96469a19777a50db090310f','Unreviewed API baseline'
dependencies=[a.server/f'libraries/org/ow2/asm/{n}/9.10.1/{n}-9.10.1.jar' for n in ['asm','asm-tree']]
assert all(f.is_file() for f in dependencies)
cp=os.pathsep.join(map(str,dependencies));source=r/'patches/SavedTaskReviewPatch.java'
subprocess.run([str(a.jdk/'bin/javac.exe'),'-proc:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',str(out),str(source)],check=True)
entry='com/dwinovo/numen/api/task/TaskPersistence.class';retired='com/dwinovo/numen/api/task/TaskPersistence$1.class'
with zipfile.ZipFile(base) as z:(out/'before.class').write_bytes(z.read(entry))
subprocess.run([str(a.jdk/'bin/java.exe'),'-cp',str(out)+os.pathsep+cp,'SavedTaskReviewPatch',str(out/'before.class'),str(out/'after.class')],check=True)
target=out/'numen_api-paper-1.21.1-0.1.4.jar'
with zipfile.ZipFile(base) as before,zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED) as after:
 descriptor=before.read('paper-plugin.yml');assert descriptor.count(b"version: '0.1.4-qd-youer1'")==1
 for row in before.infolist():
  if row.filename==retired:continue
  value=before.read(row.filename)
  if row.filename==entry:value=(out/'after.class').read_bytes()
  elif row.filename=='paper-plugin.yml':value=value.replace(b"version: '0.1.4-qd-youer1'",b"version: '0.1.4-qd-youer2'")
  after.writestr(row,value)
with zipfile.ZipFile(base) as b,zipfile.ZipFile(target) as c:
 changed=[n for n in c.namelist() if c.read(n)!=b.read(n)];removed=sorted(set(b.namelist())-set(c.namelist()))
 assert set(changed)=={entry,'paper-plugin.yml'} and removed==[retired]
receipt={'baselineSha256':sha(base),'candidateSha256':sha(target),'sourceSha256':sha(source),'changedEntries':changed,'removedEntries':removed,'otherEntriesPreserved':len(c.namelist())-len(changed),'productionChanged':False}
(out/'build.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
