"""Build reviewed vanilla/RPG compatibility changes on the approved photo/home baseline; never installs."""
from pathlib import Path
import argparse,copy,hashlib,json,os,re,subprocess,zipfile
p=argparse.ArgumentParser(description=__doc__)
for name in ['server','base','jdk','output']:p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();root=Path(__file__).resolve().parents[2];sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
assert sha(a.base)=='3d22bb98b3abd3fbfbaa4f4557f2ec0f841a6dac1a97500b74da487747846739','Review a changed AF.41 parent explicitly'
a.output.mkdir(parents=True,exist_ok=False);classes=a.output/'classes';classes.mkdir()
cp=os.pathsep.join(map(str,[classes,a.base,*a.server.glob('libraries/**/*.jar'),*a.server.glob('plugins/*.jar')]))
sources=[*[root/('plugins/AgentFriend/src/org/afuhome/agentfriend/'+n+'.java')for n in ['AgentStatePublisher','HomeLanding','WaypointManager','SiteDungeonManager','DungeonAdvice','AgentCliCatalog','ActionFeedback','CombatRpg','DungeonManager']],root/'ops/patches/CompassMethodPatch.java',root/'integrations/vortex-rpg/tests/HomeLandingUnavailableTest.java']
args=['-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',classes,*sources]
af=a.output/'compile.args';af.write_text('\n'.join('"'+str(v).replace('\\','/')+'"'for v in args),encoding='utf-8')
with(a.output/'compile.log').open('wb')as log:r=subprocess.run([a.jdk/'bin/javac.exe','@'+str(af)],stdout=log,stderr=subprocess.STDOUT)
assert r.returncode==0,'Inspect compile.log'
def java(main,*args):return subprocess.check_output([a.jdk/'bin/java.exe','-ea','-cp',cp,main,*map(str,args)],encoding='utf-8').strip()
changes={};proof={}
with zipfile.ZipFile(a.base)as z:
 for owner,method in [('AgentStatePublisher','publish'),('WaypointManager','safe|command')]:
  entry='org/afuhome/agentfriend/'+owner+'.class';before=a.output/(owner+'.before');before.write_bytes(z.read(entry));patched=a.output/(owner+'.patched')
  proof[owner]=json.loads(java('CompassMethodPatch',before,classes/entry,patched,method));assert proof[owner]['changedMethods']==(2 if owner=='WaypointManager'else 1)
  changes[entry]=patched.read_bytes()
 allowed={'HomeLanding','HomeLanding$Cell','HomeLanding$Issue','HomeLanding$Key','HomeLanding$ScanLimit','HomeLanding$Selection'}
 for file in classes.glob('org/afuhome/agentfriend/HomeLanding*.class'):
  if file.stem not in allowed:continue
  entry=file.relative_to(classes).as_posix()
  if entry not in z.namelist()or z.read(entry)!=file.read_bytes():changes[entry]=file.read_bytes()
 for owner in ['SiteDungeonManager','DungeonAdvice','AgentCliCatalog','ActionFeedback','CombatRpg','DungeonManager']:
  for file in classes.glob('org/afuhome/agentfriend/'+owner+'*.class'):
   entry=file.relative_to(classes).as_posix()
   if entry not in z.namelist()or z.read(entry)!=file.read_bytes():changes[entry]=file.read_bytes()
 descriptor,count=re.subn(rb'(?m)^version:.*$',b'version: 0.4.47.43-rpg',z.read('plugin.yml'));assert count==1;changes['plugin.yml']=descriptor
 jar=a.output/'AgentFriend-0.4.47.43-rpg.jar'
 with zipfile.ZipFile(jar,'x',zipfile.ZIP_DEFLATED)as out:
  for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
  for name,data in changes.items():
   if name not in z.namelist():out.writestr(name,data)
with zipfile.ZipFile(a.base)as before,zipfile.ZipFile(jar)as after:
 assert {n for n in after.namelist()if n not in before.namelist()or before.read(n)!=after.read(n)}==set(changes)
proof['unloadedSafety']=java('org.afuhome.agentfriend.HomeLandingUnavailableTest')
report={'artifact':jar.name,'sha256':sha(jar),'baselineSha256':sha(a.base),'changedEntries':sorted(changes),'proof':proof,'otherEntriesPreserved':len(set(before.namelist())-set(changes)),'productionChanged':False}
(a.output/'build.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
