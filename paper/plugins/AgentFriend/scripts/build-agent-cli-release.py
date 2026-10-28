"""Narrow CLI patch on the verified deployed .22; never builds the full candidate tree."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,zipfile
p=argparse.ArgumentParser();p.add_argument('--base',type=Path,required=True);p.add_argument('--server',type=Path,required=True);p.add_argument('--jdk',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
base_sha='015bdcd18c3ad07a03eed0e05f6e3c56b42cb7ec6c0f2a5b32d8d88096f06f13'
assert not a.output.exists() and hashlib.sha256(a.base.read_bytes()).hexdigest()==base_sha
root=Path(__file__).resolve().parents[1];build=a.output.parent/(a.output.stem+'.build');build.mkdir(parents=True);classes=build/'classes';classes.mkdir()
names=['NativeRpg','AgentCliCatalog','AgentCliText'];prefix='org/afuhome/agentfriend/'
sources=[root/'src'/prefix/(name+'.java') for name in names]
cp=os.pathsep.join(map(str,[a.base,*sorted((a.server/'libraries').rglob('*.jar')),*sorted((a.server/'versions').rglob('*.jar')),*sorted((a.server/'plugins').glob('*.jar'))]))
args=['-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',str(classes),*map(str,sources)]
arg=build/'javac.args';arg.write_text('\n'.join('"'+v.replace('\\','/')+'"'for v in args),encoding='utf8')
r=subprocess.run([str(a.jdk/'bin/javac.exe'),'@'+str(arg)],capture_output=True);(build/'javac.stderr').write_bytes(r.stderr)
if r.returncode:print(r.stderr.decode('utf8',errors='replace'));raise SystemExit(r.returncode)
compiled={f.relative_to(classes).as_posix():f.read_bytes()for f in classes.rglob('*.class')}
def own(n):return any(n==prefix+name+'.class' or n.startswith(prefix+name+'$')for name in names)
assert all(own(n)for n in compiled);retained=0
with zipfile.ZipFile(a.base)as src,zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED)as out:
 for entry in src.infolist():
  if own(entry.filename):continue
  data=src.read(entry)
  if entry.filename=='plugin.yml':assert b'0.4.47.22-vortex'in data;data=data.replace(b'0.4.47.22-vortex',b'0.4.47.23-vortex')
  else:retained+=1
  out.writestr(entry,data)
 for name,data in compiled.items():out.writestr(name,data)
with zipfile.ZipFile(a.base)as before,zipfile.ZipFile(a.output)as after:
 for name in before.namelist():
  if not own(name) and name!='plugin.yml':assert before.read(name)==after.read(name),name
a.output.with_suffix('.json').write_text(json.dumps({'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'baseSha256':base_sha,'retainedEntries':retained,'changedClasses':sorted(compiled),'sources':{f.name:hashlib.sha256(f.read_bytes()).hexdigest()for f in sources},'productionChanged':False},indent=2)+'\n',encoding='utf8')
print(f'CLI-only candidate: {retained} other entries retained')
