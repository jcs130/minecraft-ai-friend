"""Build optional photo captions and digital diaries on the frozen home/cooperation candidate."""
from pathlib import Path
import argparse,copy,hashlib,json,os,re,subprocess,zipfile
p=argparse.ArgumentParser(description=__doc__)
for key in ['server','base','jdk','output']:p.add_argument('--'+key,type=Path,required=True)
a=p.parse_args();paper=Path(__file__).resolve().parents[2];sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(a.base)=='46416fef8628e34159f944211063effa5982efab3868aa6fd13875d4c40e6bce','Review changed cumulative parent explicitly'
a.output.mkdir(parents=True,exist_ok=False);classes=a.output/'classes';classes.mkdir()
cp=os.pathsep.join(map(str,[classes,a.base,*a.server.glob('libraries/**/*.jar'),*a.server.glob('plugins/*.jar')]))
source=paper/'plugins/AgentFriend/src/org/afuhome/agentfriend'
owners=['PhotoCameraManager','PhotoJournal','PublicArchives','AgentCliCatalog']
sources=[*[source/(n+'.java')for n in owners],source/'PhotoRequest.java',paper/'ops/patches/CompassMethodPatch.java',paper/'ops/patches/PhotoSocialPatch.java',paper/'ops/patches/PhotoDeliveryPatch.java',paper/'plugins/AgentFriend/tests/org/afuhome/agentfriend/PhotoRequestTest.java']
args=['-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',classes,*sources]
f=a.output/'compile.args';f.write_text('\n'.join('"'+str(x).replace('\\','/')+'"'for x in args),encoding='utf-8')
with(a.output/'compile.log').open('wb')as log:r=subprocess.run([a.jdk/'bin/javac.exe','@'+str(f)],stdout=log,stderr=subprocess.STDOUT)
assert r.returncode==0,'Inspect compile.log'
def java(main,*args):
 f=a.output/'java-run.args';f.write_text('\n'.join(json.dumps(str(x),ensure_ascii=False)for x in ['-ea','-cp',cp,main,*args]),encoding='utf-8')
 r=subprocess.run([a.jdk/'bin/java.exe','@'+str(f)],capture_output=True,text=True,encoding='utf-8')
 if r.returncode:raise RuntimeError(main+': '+r.stderr[-1800:])
 return r.stdout.strip()
changes={};proof={}
patterns={'PhotoCameraManager':r'command','PhotoJournal':'delivered','PublicArchives':r'command|create|lambda\$create\$.*','AgentCliCatalog':'createSpecs'}
with zipfile.ZipFile(a.base)as z:
 for owner in owners:
  entry='org/afuhome/agentfriend/'+owner+'.class';old=a.output/(owner+'.before');old.write_bytes(z.read(entry));patched=a.output/(owner+'.patched.class')
  proof[owner]=json.loads(java('PhotoSocialPatch',old,classes/entry,patched,patterns[owner]));changes[entry]=patched.read_bytes()
  if owner=='PhotoCameraManager':
   delivered=a.output/'camera-delivery.class';proof['delivery']=json.loads(java('PhotoDeliveryPatch',patched,delivered));changes[entry]=delivered.read_bytes()
 for name in ['PhotoCameraManager$Job','PhotoRequest']:
  entry='org/afuhome/agentfriend/'+name+'.class';changes[entry]=(classes/entry).read_bytes()
 descriptor,count=re.subn(rb'(?m)^version:.*$',b'version: 0.4.47.41-rpg',z.read('plugin.yml'));assert count==1;changes['plugin.yml']=descriptor
 out=a.output/'AgentFriend-0.4.47.41-rpg.jar'
 with zipfile.ZipFile(out,'x',zipfile.ZIP_DEFLATED)as target:
  for info in z.infolist():target.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
  for name,data in changes.items():
   if name not in z.namelist():target.writestr(name,data)
with zipfile.ZipFile(a.base)as old,zipfile.ZipFile(out)as new:
 changed={n for n in new.namelist()if n not in old.namelist()or old.read(n)!=new.read(n)};assert changed==set(changes)
 proof['unrelatedJarEntriesPreserved']=len(set(old.namelist())-set(changes))
proof['requestRules']=java('org.afuhome.agentfriend.PhotoRequestTest')
report={'productionChanged':False,'baseSha256':sha(a.base),'candidate':str(out),'sha256':sha(out),'changedEntries':sorted(changes),'proof':proof,'sourceSha256':{str(f.relative_to(paper.parent)).replace('\\','/'):sha(f)for f in sources}}
(a.output/'build.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
