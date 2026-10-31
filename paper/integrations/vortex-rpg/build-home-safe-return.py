"""Narrow home-return candidate on the frozen cooperation build; never installs or edits players."""
from pathlib import Path
import argparse,copy,hashlib,json,os,re,subprocess,zipfile

p=argparse.ArgumentParser(description=__doc__)
for key in ['server','base','jdk','output']:p.add_argument('--'+key,type=Path,required=True)
a=p.parse_args();paper=Path(__file__).resolve().parents[2]
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(a.base)=='56a6a768cb45dbbe79fd76f6a21c443b2594c9bd0f7c5f091e07104d0ace8bbb','Rebase changed cooperation parent explicitly'
a.output.mkdir(parents=True,exist_ok=False);classes=a.output/'classes';classes.mkdir()
cp=os.pathsep.join(map(str,[classes,a.base,*a.server.glob('libraries/**/*.jar'),*a.server.glob('plugins/*.jar')]))
source=paper/'plugins/AgentFriend/src/org/afuhome/agentfriend'
sources=[*[source/(n+'.java')for n in ['HomeLanding','TravelMagic','AgentFriendPlugin','SpellGuide']],paper/'ops/patches/CompassMethodPatch.java',paper/'ops/patches/HomeReturnPatch.java',paper/'integrations/vortex-rpg/tests/HomeLandingUnavailableTest.java']
args=['-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',classes,*sources]
argfile=a.output/'compile.args';argfile.write_text('\n'.join('"'+str(v).replace('\\','/')+'"'for v in args),encoding='utf-8')
with(a.output/'compile.log').open('wb')as log:result=subprocess.run([a.jdk/'bin/javac.exe','@'+str(argfile)],stdout=log,stderr=subprocess.STDOUT)
assert result.returncode==0,'Inspect compile.log'
def java(main,*args):return subprocess.check_output([a.jdk/'bin/java.exe','-ea','-cp',cp,main,*map(str,args)],text=True,encoding='utf-8').strip()
changes={};proof={}
with zipfile.ZipFile(a.base)as z:
 for owner in ['TravelMagic','AgentFriendPlugin','SpellGuide']:
  entry='org/afuhome/agentfriend/'+owner+'.class';old=a.output/(owner+'.before');old.write_bytes(z.read(entry))
  if owner=='TravelMagic':
   proof['travel']=json.loads(java('HomeReturnPatch',old,classes/entry));changes[entry]=(classes/entry).read_bytes()
  elif owner=='AgentFriendPlugin':
   patched=a.output/(owner+'.patched.class');proof['destinationReceipt']=json.loads(java('CompassMethodPatch',old,classes/entry,patched,'gotoPlace'));changes[entry]=patched.read_bytes()
  else:
   patched=a.output/(owner+'.patched.class');proof['homeGuide']=json.loads(java('HomeReturnPatch',old,classes/entry,patched,'guide'));changes[entry]=patched.read_bytes()
 allowed={'HomeLanding','HomeLanding$Cell','HomeLanding$Issue','HomeLanding$Key','HomeLanding$ScanLimit','HomeLanding$Selection'}
 for name in allowed:
  file=classes/'org/afuhome/agentfriend'/(name+'.class');changes[file.relative_to(classes).as_posix()]=file.read_bytes()
 descriptor,count=re.subn(rb'(?m)^version:.*$',b'version: 0.4.47.40-rpg',z.read('plugin.yml'));assert count==1;changes['plugin.yml']=descriptor
 out=a.output/'AgentFriend-0.4.47.40-rpg.jar'
 with zipfile.ZipFile(out,'x',zipfile.ZIP_DEFLATED)as dest:
  for info in z.infolist():dest.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
  for name,data in changes.items():
   if name not in z.namelist():dest.writestr(name,data)
with zipfile.ZipFile(a.base)as old,zipfile.ZipFile(out)as new:
 changed={n for n in new.namelist()if n not in old.namelist()or old.read(n)!=new.read(n)}
 assert changed==set(changes)
 proof['unrelatedJarEntriesPreserved']=len(set(old.namelist())-set(changes))
proof['unloadedRules']=java('org.afuhome.agentfriend.HomeLandingUnavailableTest')
report={'productionChanged':False,'baseSha256':sha(a.base),'candidate':str(out),'sha256':sha(out),'changedEntries':sorted(changes),'proof':proof,'sourceSha256':{str(f.relative_to(paper.parent)):sha(f)for f in sources}}
(a.output/'build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
