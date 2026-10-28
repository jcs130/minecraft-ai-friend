"""Build only MMORPG guidance fixes on the deployed .21 base; no mcbot candidates."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,zipfile
p=argparse.ArgumentParser();p.add_argument('--base',type=Path,required=True);p.add_argument('--server',type=Path,required=True);p.add_argument('--jdk',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
assert not a.output.exists()and hashlib.sha256(a.base.read_bytes()).hexdigest()=='21ca97582f26fc2f71ec1a6a1f99af36bfd9d1cacea74fc9dbef73296431a179'
root=Path(__file__).resolve().parent.parent;out=a.output.parent/(a.output.stem+'.build');out.mkdir();classes=out/'classes';classes.mkdir()
names=['AgentFriendPlugin','NativeRpg','OnboardingGuide','AgentCoach']
sources=[root/'src/org/afuhome/agentfriend'/(name+'.java')for name in names]
cp=os.pathsep.join(map(str,[a.base,*sorted((a.server/'libraries').rglob('*.jar')),*sorted((a.server/'versions').rglob('*.jar')),*sorted((a.server/'plugins').glob('*.jar'))]))
args=['-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',str(classes),*map(str,sources)]
argfile=out/'javac.args';argfile.write_text('\n'.join('"'+s.replace('\\','/')+'"'for s in args),encoding='utf8')
r=subprocess.run([str(a.jdk/'bin/javac.exe'),'@'+str(argfile)],capture_output=True);(out/'javac.stderr').write_bytes(r.stderr)
if r.returncode:print(r.stderr.decode('utf8',errors='replace'));raise SystemExit(r.returncode)
compiled={f.relative_to(classes).as_posix():f.read_bytes()for f in classes.rglob('*.class')};prefix='org/afuhome/agentfriend/'
def own(n):return any(n==prefix+name+'.class'or n.startswith(prefix+name+'$')for name in names)
assert all(own(n)for n in compiled);retained=0
with zipfile.ZipFile(a.base)as src,zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED)as z:
 for entry in src.infolist():
  if own(entry.filename):assert entry.filename in compiled;continue
  data=src.read(entry)
  if entry.filename=='plugin.yml':assert b'0.4.47.21-vortex'in data;data=data.replace(b'0.4.47.21-vortex',b'0.4.47.22-vortex')
  else:retained+=1
  z.writestr(entry,data)
 for name,data in compiled.items():z.writestr(name,data)
a.output.with_suffix('.json').write_text(json.dumps({'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'baseSha256':hashlib.sha256(a.base.read_bytes()).hexdigest(),'retainedEntries':retained,'changedClasses':sorted(compiled),'sources':{f.name:hashlib.sha256(f.read_bytes()).hexdigest()for f in sources},'productionChanged':False},indent=2)+'\n',encoding='utf8')
print('Built .22 guidance only; all unrelated entries retained')
