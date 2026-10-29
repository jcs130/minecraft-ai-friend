"""Narrow storage-priority correction on pinned 0.2.7, no Vortex or player data changes."""
from pathlib import Path
import argparse,os,hashlib,subprocess,zipfile,json
p=argparse.ArgumentParser();p.add_argument('--server',type=Path,required=True);p.add_argument('--base',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
assert hashlib.sha256(a.base.read_bytes()).hexdigest()=='c7275c72d20b9cbc2e03489fa05bc218983d8a4c1226d6d8b67b79b9cfb73f2a'
assert not a.output.exists()and a.server.resolve()not in a.output.resolve().parents
root=Path(__file__).resolve().parent;out=a.output.parent/(a.output.stem+'.build');out.mkdir();classes=out/'classes';classes.mkdir();(out/'empty').mkdir()
names=['RpgJourney','VortexBridge','NativeParties','ClassInfoView'];src=[root/'src/org/qiandengji/vortex'/(n+'.java')for n in names]
cp=os.pathsep.join(map(str,[a.base,*sorted((a.server/'plugins').glob('*.jar')),*sorted((a.server/'libraries').rglob('*.jar')),*sorted((a.server/'versions').rglob('*.jar'))]))
args=['-proc:none','-implicit:none','-encoding','UTF-8','--release','21','-sourcepath',str(out/'empty'),'-cp',cp,'-d',str(classes),*map(str,src)]
af=out/'javac.args';af.write_text('\n'.join('"'+s.replace('\\','/')+'"'for s in args),encoding='utf8')
r=subprocess.run(['E:/MC/jdk/jdk-21.0.12.1+1/bin/javac.exe','@'+str(af)],capture_output=True);(out/'javac.log').write_bytes(r.stderr)
if r.returncode:print(r.stderr.decode('utf8','replace'));raise SystemExit(r.returncode)
prefix='org/qiandengji/vortex/'
def own(n):return any(n==prefix+name+'.class'or n.startswith(prefix+name+'$')for name in names)
compiled={f.relative_to(classes).as_posix():f.read_bytes()for f in classes.rglob('*.class')};assert all(own(n)for n in compiled)
keep=[]
with zipfile.ZipFile(a.base)as old,zipfile.ZipFile(a.output,'x',zipfile.ZIP_DEFLATED)as z:
 for e in old.infolist():
  if own(e.filename):continue
  data=old.read(e)
  if e.filename=='plugin.yml':assert data.count(b'version: 0.2.7')==1;data=data.replace(b'version: 0.2.7',b'version: 0.2.9')
  else:keep.append(e.filename)
  z.writestr(e,data)
 for n,data in compiled.items():z.writestr(n,data)
with zipfile.ZipFile(a.base)as old,zipfile.ZipFile(a.output)as new:
 for n in keep:assert old.read(n)==new.read(n),n
report={'version':'0.2.9','sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'retainedEntries':len(keep),'sources':{f.name:hashlib.sha256(f.read_bytes()).hexdigest()for f in src},'deployed':False}
a.output.with_suffix('.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))
