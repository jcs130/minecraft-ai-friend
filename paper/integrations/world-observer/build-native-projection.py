"""Narrow packet projection and actual sent-chunk compatibility on a pinned baseline; never installs."""
from pathlib import Path
import argparse,copy,hashlib,json,os,re,subprocess,zipfile
p=argparse.ArgumentParser(description=__doc__)
for name in ['server','jdk','output']:p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();root=Path(__file__).resolve().parent;sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
base=a.server/'plugins/WorldObserver-0.1.1.jar'
assert sha(base)=='f1b4d51fca8bb87b1a945f939a190ce01acc0b372e81dd18b57d8b2c02022d3d','Review a changed observer baseline'
a.output.mkdir(parents=True,exist_ok=False);classes=a.output/'classes';classes.mkdir()
cp=os.pathsep.join(map(str,[classes,base,*a.server.glob('libraries/**/*.jar'),*a.server.glob('plugins/*.jar')]))
sources=[root/'src/org/qiandeng/observer/WorldObserverPlugin.java',root/'src/org/qiandeng/observer/NativeObserverProjection.java',root.parents[1]/'ops/patches/CompassMethodPatch.java']
args=['-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',classes,*sources]
af=a.output/'compile.args';af.write_text('\n'.join('"'+str(v).replace('\\','/')+'"'for v in args),encoding='utf-8')
with(a.output/'compile.log').open('wb')as log:r=subprocess.run([a.jdk/'bin/javac.exe','@'+str(af)],stdout=log,stderr=subprocess.STDOUT)
assert r.returncode==0,'Inspect compile.log'
entry='org/qiandeng/observer/WorldObserverPlugin.class';changes={}
with zipfile.ZipFile(base)as z:
 before=a.output/'observer.before.class';before.write_bytes(z.read(entry));patched=a.output/'observer.patched.class'
 proof=json.loads(subprocess.check_output([a.jdk/'bin/java.exe','-cp',cp,'CompassMethodPatch',before,classes/entry,patched,r'add|visibleChunks|tick|playerState|lambda\$tick\$.*'],encoding='utf-8'))
 assert proof['changedMethods']==5
 changes[entry]=patched.read_bytes()
 helper='org/qiandeng/observer/NativeObserverProjection.class';changes[helper]=(classes/helper).read_bytes()
 descriptor,count=re.subn(rb'(?m)^version:.*$',b'version: 0.1.2',z.read('plugin.yml'));assert count==1;changes['plugin.yml']=descriptor
 jar=a.output/'WorldObserver-0.1.2.jar'
 with zipfile.ZipFile(jar,'x',zipfile.ZIP_DEFLATED)as out:
  for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
  for name,data in changes.items():
   if name not in z.namelist():out.writestr(name,data)
with zipfile.ZipFile(base)as before,zipfile.ZipFile(jar)as after:
 assert {n for n in after.namelist()if n not in before.namelist()or before.read(n)!=after.read(n)}==set(changes)
report={'artifact':jar.name,'sha256':sha(jar),'baselineSha256':sha(base),'changedEntries':sorted(changes),'proof':proof,'otherEntriesPreserved':len(set(before.namelist())-set(changes)),'productionChanged':False}
(a.output/'build.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
