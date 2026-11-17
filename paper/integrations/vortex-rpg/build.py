"""Build only our API adapter. Never redistributes Vortex or a live config."""
from pathlib import Path
import argparse,os,subprocess,zipfile,hashlib,re,json
p=argparse.ArgumentParser();p.add_argument('--server',type=Path,required=True);p.add_argument('--vortex',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
p.add_argument('--java-home',type=Path);p.add_argument('--baseline',type=Path);p.add_argument('--baseline-sha256');a=p.parse_args()
if bool(a.baseline)!=bool(a.baseline_sha256):p.error('baseline and its reviewed SHA256 are required together')
if a.baseline and hashlib.sha256(a.baseline.read_bytes()).hexdigest()!=a.baseline_sha256:raise ValueError('baseline changed')
if a.output.resolve().is_relative_to(a.server.resolve()):raise ValueError('candidate must be outside server')
assert not a.output.exists(),'new output required'
root=Path(__file__).resolve().parent;java=(a.java_home/'bin' if a.java_home else Path('E:/MC/jdk/jdk-21.0.12.1+1/bin'));classes=a.output.parent/(a.output.stem+'.build')/'classes';classes.mkdir(parents=True)
cp=os.pathsep.join(map(str,[a.vortex,a.server/'plugins/Vault-1.7.3.jar',*a.server.rglob('libraries/**/*.jar')]))
result=subprocess.run([str(java/('javac.exe' if os.name=='nt' else 'javac')),'-J-Duser.language=en','-J-Dfile.encoding=UTF-8','-proc:none','-encoding','UTF-8','--release','21','-cp',cp,'-d',str(classes),*map(str,(root/'src').rglob('*.java'))],capture_output=True)
if result.returncode:
 print(result.stderr.decode('utf8',errors='replace'));raise SystemExit(result.returncode)
entries={}
if a.baseline:
 with zipfile.ZipFile(a.baseline)as z:entries={n:z.read(n)for n in z.namelist()if not n.endswith('/')}
before=entries.copy()
for base in ([classes] if a.baseline else [classes,root/'resources']):
 for f in base.rglob('*'):
  if f.is_file():entries[f.relative_to(base).as_posix()]=f.read_bytes()
descriptor,count=re.subn(r'(?m)^version:.*$', 'version: 0.2.32-swordsman-candidate', entries['plugin.yml'].decode('utf8'));assert count==1
entries['plugin.yml']=descriptor.encode('utf8')
assert all(n in entries for n in before)
assert all(entries[n]==v for n,v in before.items()if not n.endswith('.class') and n!='plugin.yml')
with zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED)as z:
 for name,value in sorted(entries.items()):
  info=zipfile.ZipInfo(name,(2026,11,17,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,value)
a.output.with_suffix('.build.json').write_text(json.dumps({'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'baselineSha256':a.baseline_sha256,'retainedResources':bool(a.baseline),'changedEntries':[n for n,v in entries.items()if before.get(n)!=v]},indent=2),encoding='utf8')
print(a.output.name)
