"""Narrow, reviewed journey/help patch on deployed .25. Never installs or copies player data."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,zipfile
p=argparse.ArgumentParser()
for name in ['base','server','jdk','output']:p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();pin='46b590db9fd01d0129f9c8f090ca7c0d5e2c1ee0544d3c1a267aed2df1cd62d6'
assert not a.output.exists() and hashlib.sha256(a.base.read_bytes()).hexdigest()==pin
root=Path(__file__).resolve().parents[1];build=a.output.parent/(a.output.stem+'.build');build.mkdir(parents=True)
classes=build/'classes';classes.mkdir();empty=build/'empty';empty.mkdir()
names=['NativeRpg','AgentCliCatalog'];prefix='org/afuhome/agentfriend/'
sources=[root/'src'/prefix/(n+'.java') for n in names]
cp=os.pathsep.join(map(str,[a.base,*sorted((a.server/'libraries').rglob('*.jar')),*sorted((a.server/'versions').rglob('*.jar')),*sorted((a.server/'plugins').glob('*.jar'))]))
args=['-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-sourcepath',str(empty),'-cp',cp,'-d',str(classes),*map(str,sources)]
argfile=build/'javac.args';argfile.write_text('\n'.join('"'+v.replace('\\','/')+'"'for v in args),encoding='utf-8')
r=subprocess.run([str(a.jdk/'bin/javac.exe'),'@'+str(argfile)],capture_output=True);(build/'javac.stderr').write_bytes(r.stderr)
if r.returncode:print(r.stderr.decode('utf-8',errors='replace'));raise SystemExit(r.returncode)
compiled={f.relative_to(classes).as_posix():f.read_bytes()for f in classes.rglob('*.class')}
def owns(n):return any(n==prefix+x+'.class' or n.startswith(prefix+x+'$')for x in names)
assert all(owns(n)for n in compiled)
retained=0
with zipfile.ZipFile(a.base)as before,zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED)as out:
 for entry in before.infolist():
  if owns(entry.filename):continue
  value=before.read(entry)
  if entry.filename=='plugin.yml':
   assert b'0.4.47.25-vortex' in value;value=value.replace(b'0.4.47.25-vortex',b'0.4.47.26-vortex')
  elif entry.filename=='onboarding.yml':
   fresh=(root/'resources/onboarding.yml').read_bytes();key=b'release-revision:'
   assert fresh.count(key)==1;tail=fresh.split(key,1)[1];assert tail.startswith(b' 4')
   value=value.split(key,1)[0]+key+tail
  else:retained+=1
  out.writestr(entry,value)
 for name,value in compiled.items():out.writestr(name,value)
with zipfile.ZipFile(a.base)as before,zipfile.ZipFile(a.output)as after:
 for name in before.namelist():
  if not owns(name)and name not in {'plugin.yml','onboarding.yml'}:assert before.read(name)==after.read(name),name
proof={'baseSha256':pin,'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'retainedEntries':retained,'changedClasses':sorted(compiled),'sources':{str(f.relative_to(root)):hashlib.sha256(f.read_bytes()).hexdigest()for f in sources},'productionChanged':False}
a.output.with_suffix('.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8');print(json.dumps({'retainedEntries':retained,'changedClasses':len(compiled),'productionChanged':False}))
