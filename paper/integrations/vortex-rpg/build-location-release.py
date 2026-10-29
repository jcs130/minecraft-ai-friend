"""Add world-aware read results to pinned 0.2.9 without changing RPG rules/data."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,zipfile
p=argparse.ArgumentParser(description=__doc__)
for name in ('server','base','output','java'):p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();assert hashlib.sha256(a.base.read_bytes()).hexdigest()=='6ce52479a3317db83442cd00817608ff6b3e70dafdf9d072c79dc2d2f8c2c8e9'
assert not a.output.exists() and a.server.resolve() not in a.output.resolve().parents
root=Path(__file__).resolve().parent;build=a.output.parent/(a.output.stem+'.build');build.mkdir();classes=build/'classes';classes.mkdir();(build/'empty').mkdir()
names=['VortexBridge','NativeParties','PlayerLocationView'];src=[root/'src/org/qiandengji/vortex'/(name+'.java')for name in names]
cp=os.pathsep.join(map(str,[a.base,*sorted((a.server/'plugins').glob('*.jar')),*sorted((a.server/'libraries').rglob('*.jar')),*sorted((a.server/'versions').rglob('*.jar'))]))
args=['-proc:none','-implicit:none','-encoding','UTF-8','--release','21','-sourcepath',str(build/'empty'),'-cp',cp,'-d',str(classes),*map(str,src)]
argfile=build/'javac.args';argfile.write_text('\n'.join('"'+s.replace('\\','/')+'"'for s in args),encoding='utf8')
r=subprocess.run([str(a.java/'javac.exe'),'@'+str(argfile)],capture_output=True);(build/'javac.log').write_bytes(r.stderr)
if r.returncode:print(r.stderr.decode('utf8','replace'));raise SystemExit(r.returncode)
prefix='org/qiandengji/vortex/'
def own(n):return any(n==prefix+name+'.class'or n.startswith(prefix+name+'$')for name in names)
compiled={f.relative_to(classes).as_posix():f.read_bytes()for f in classes.rglob('*.class')};assert all(own(n)for n in compiled)
keep=[]
with zipfile.ZipFile(a.base)as old,zipfile.ZipFile(a.output,'x',zipfile.ZIP_DEFLATED)as z:
 for e in old.infolist():
  if own(e.filename):continue
  data=old.read(e)
  if e.filename=='plugin.yml':assert data.count(b'version: 0.2.9')==1;data=data.replace(b'version: 0.2.9',b'version: 0.2.10')
  else:keep.append(e.filename)
  z.writestr(e,data)
 for n,data in compiled.items():z.writestr(n,data)
with zipfile.ZipFile(a.base)as old,zipfile.ZipFile(a.output)as new:
 for n in keep:assert old.read(n)==new.read(n),n
report={'version':'0.2.10','sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'retainedEntries':len(keep),'sources':{f.name:hashlib.sha256(f.read_bytes()).hexdigest()for f in src},'deployed':False}
a.output.with_suffix('.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))
