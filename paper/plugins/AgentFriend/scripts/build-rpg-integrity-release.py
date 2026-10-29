"""Build reviewed dungeon/death/viewer fixes on the pinned .28 compass candidate; never installs."""
from pathlib import Path
import argparse,hashlib,os,subprocess,zipfile,json
p=argparse.ArgumentParser();p.add_argument('--base',type=Path,required=True);p.add_argument('--server',type=Path,required=True);p.add_argument('--jdk',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
assert hashlib.sha256(a.base.read_bytes()).hexdigest()=='f24d99c73639b904c6d3188e05900e5d70cfdf802155be3f0c61b9d7430287a7'
assert not a.output.exists() and a.server.resolve() not in a.output.resolve().parents
root=Path(__file__).resolve().parents[1];out=a.output.parent/(a.output.stem+'.build');out.mkdir();classes=out/'classes';classes.mkdir();empty=out/'empty';empty.mkdir()
names=['NativeRpg','SiteDungeonManager','DungeonIntegrity','BlockAccessPolicy','ProtectionAdvisor','ProtectionQuery','TrialRescueManager','ViewerStatePublisher','ActionFeedback']
sources=[root/'src/org/afuhome/agentfriend'/(name+'.java') for name in names]
cp=os.pathsep.join(map(str,[a.base,*sorted((a.server/'versions').rglob('*.jar')),*sorted((a.server/'libraries').rglob('*.jar')),*sorted((a.server/'plugins').glob('*.jar'))]))
args=['-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-sourcepath',str(empty),'-cp',cp,'-d',str(classes),*map(str,sources)]
argfile=out/'javac.args';argfile.write_text('\n'.join('"'+s.replace('\\','/')+'"'for s in args),encoding='utf8')
r=subprocess.run([str(a.jdk/'bin/javac.exe'),'@'+str(argfile)],capture_output=True);(out/'javac.log').write_bytes(r.stderr)
if r.returncode:print(r.stderr.decode('utf8','replace'));raise SystemExit(r.returncode)
prefix='org/afuhome/agentfriend/'
patch=out/'patch';patch.mkdir()
with zipfile.ZipFile(a.base)as z:
 (patch/'before.class').write_bytes(z.read(prefix+'AgentFriendPlugin.class'))
 (patch/'catalog-before.class').write_bytes(z.read(prefix+'AgentCliCatalog.class'))
export='java.base/jdk.internal.org.objectweb.asm=ALL-UNNAMED'
subprocess.run([str(a.jdk/'bin/javac.exe'),'--add-exports',export,'-encoding','UTF-8','-d',str(patch),str(root/'scripts/AddViewerSnapshotABI.java')],check=True)
subprocess.run([str(a.jdk/'bin/java.exe'),'--add-exports',export,'-cp',str(patch),'AddViewerSnapshotABI',str(patch/'before.class'),str(patch/'after.class'),str(patch/'catalog-before.class'),str(patch/'catalog-after.class')],check=True)
def own(n):return any(n==prefix+name+'.class'or n.startswith(prefix+name+'$')for name in names)
compiled={f.relative_to(classes).as_posix():f.read_bytes()for f in classes.rglob('*.class')};assert all(own(n)for n in compiled)
retained=[]
with zipfile.ZipFile(a.base)as old,zipfile.ZipFile(a.output,'x',zipfile.ZIP_DEFLATED)as z:
 for entry in old.infolist():
  if own(entry.filename):continue
  data=old.read(entry)
  if entry.filename==prefix+'AgentFriendPlugin.class':data=(patch/'after.class').read_bytes()
  elif entry.filename==prefix+'AgentCliCatalog.class':data=(patch/'catalog-after.class').read_bytes()
  elif entry.filename=='plugin.yml':
   assert data.count(b'0.4.47.28')==1;data=data.replace(b'0.4.47.28',b'0.4.47.29')
  else:retained.append(entry.filename)
  z.writestr(entry,data)
 for name,data in compiled.items():z.writestr(name,data)
with zipfile.ZipFile(a.base)as old,zipfile.ZipFile(a.output)as new:
 for name in retained:assert old.read(name)==new.read(name),name
report={'version':'0.4.47.29','sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'baseSha256':hashlib.sha256(a.base.read_bytes()).hexdigest(),'retainedEntries':len(retained),'changedClasses':sorted(compiled)+[prefix+'AgentFriendPlugin.class',prefix+'AgentCliCatalog.class'],'sources':{f.name:hashlib.sha256(f.read_bytes()).hexdigest()for f in sources},'deployed':False}
a.output.with_suffix('.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps({k:report[k]for k in ['version','sha256','retainedEntries']}))
