"""Build the reviewed one-method AF patch without replacing unrelated classes."""
from pathlib import Path
import argparse,copy,hashlib,json,os,subprocess,zipfile

p=argparse.ArgumentParser()
p.add_argument('--server',type=Path,required=True)
p.add_argument('--baseline',type=Path,required=True)
p.add_argument('--jdk',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
a=p.parse_args();paper=Path(__file__).resolve().parents[1]
assert hashlib.sha256(a.baseline.read_bytes()).hexdigest()=='6e94b4a69301e8cf48871752a2c1e01b2484840e43300c833ad8db162e857c53'
a.output.mkdir(parents=True,exist_ok=False);classes=a.output/'classes';classes.mkdir()
cp=os.pathsep.join(str(x.resolve())for x in[a.baseline,*(a.server/'libraries').rglob('*.jar'),*(a.server/'plugins').glob('*.jar')])
sources=[paper/'plugins/AgentFriend/src/org/afuhome/agentfriend/AgentFriendPlugin.java',paper/'ops/patches/CompassMethodPatch.java']
args=['-proc:none','-implicit:none','-encoding','UTF-8','--release','21','-cp',cp,'-d',str(classes),*map(str,sources)]
argfile=a.output/'javac.args';argfile.write_text('\n'.join('"'+s.replace('\\','/')+'"'for s in args),encoding='utf8')
subprocess.run([str(a.jdk/'bin/javac.exe'),'@'+str(argfile)],check=True)
entry='org/afuhome/agentfriend/AgentFriendPlugin.class'
with zipfile.ZipFile(a.baseline)as z:(a.output/'before.class').write_bytes(z.read(entry))
patched=a.output/'patched.class'
patchargs=['-cp',str(classes)+os.pathsep+cp,'CompassMethodPatch',str(a.output/'before.class'),str(classes/entry),str(patched)]
patchfile=a.output/'patch.args';patchfile.write_text('\n'.join('"'+s.replace('\\','/')+'"'for s in patchargs),encoding='utf8')
record=json.loads(subprocess.check_output([str(a.jdk/'bin/java.exe'),'@'+str(patchfile)],text=True))
candidate=a.output/'AgentFriend-0.4.47.36-compat.jar'
with zipfile.ZipFile(a.baseline)as before,zipfile.ZipFile(candidate,'x',zipfile.ZIP_DEFLATED)as after:
 for info in before.infolist():
  data=before.read(info.filename)
  if info.filename==entry:data=patched.read_bytes()
  if info.filename=='plugin.yml':
   assert data.count(b'0.4.47.34-vortex')==1
   data=data.replace(b'0.4.47.34-vortex',b'0.4.47.36-compat')
  after.writestr(copy.copy(info),data)
with zipfile.ZipFile(a.baseline)as before,zipfile.ZipFile(candidate)as after:
 assert set(before.namelist())==set(after.namelist())
 changed=[n for n in before.namelist()if before.read(n)!=after.read(n)]
 assert set(changed)=={entry,'plugin.yml'}
 record.update(changedEntries=changed,unrelatedEntriesPreserved=len(before.namelist())-2)
record.update(candidate=str(candidate),sha256=hashlib.sha256(candidate.read_bytes()).hexdigest(),productionChanged=False)
(a.output/'build.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
