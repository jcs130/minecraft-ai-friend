"""Build bounded display/guide repairs from the deployed native RPG artifacts."""
from pathlib import Path
import argparse,copy,hashlib,json,os,re,subprocess,zipfile

p=argparse.ArgumentParser();p.add_argument('--server',type=Path,required=True);p.add_argument('--native-source',type=Path,required=True);p.add_argument('--jdk',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
here=Path(__file__).resolve().parent;paper=here.parents[1];a.output.mkdir(parents=True,exist_ok=False)
base={'native':a.server/'plugins/VortexRPG-1.2.2-alpha-qd29.jar','bridge':a.server/'plugins/QiandengjiRpg-0.2.10.jar','friend':a.server/'plugins/AgentFriend-0.4.47.36-compat.jar'}
pins={'native':'9437787768e54b4a10b04702ecbc1001088c57c51aed461ecadf7dcd882f001a','bridge':'b019698d7b60b9dc1500e743beb52f3db2590a7a1d9e980563a6a0fe4c14be0a','friend':'48fee27293e134b5495857441b831dc5bf1722e6e301e0fd28a932ca9c882ebe'}
sha=lambda f:hashlib.sha256(Path(f).read_bytes()).hexdigest()
assert all(sha(base[k])==v for k,v in pins.items())
source=a.native_source/'src/main/java/io/vortexcore/ui/ScoreboardService.java'
assert sha(source)=='20085df675ea6c8aa707e4842675b579c1bb22845839263b65cdf94741b9ed73','Unreviewed upstream scoreboard source'
commit=subprocess.check_output(['git','-C',str(a.native_source),'rev-parse','HEAD'],text=True).strip();assert commit.startswith('3e5baba')
classes=a.output/'classes';classes.mkdir();generated=a.output/'generated/io/vortexcore/ui';generated.mkdir(parents=True)
text=source.read_text(encoding='utf8');needle='        long xpNext = playerProfileService.experienceToNextLevel(profile);';assert text.count(needle)==1
text=text.replace(needle,needle+'\n        var growth = io.vortexcore.rpg.ExperienceProgress.of(profile, playerProfileService.experienceCurve());')
needle='                .replace("{xp_next}", Long.toString(xpNext))';assert text.count(needle)==1
text=text.replace(needle,needle+'\n                .replace("{xp_display}", growth.display())\n                .replace("{xp_progress}", Long.toString(growth.progress()))\n                .replace("{xp_required}", Long.toString(growth.required()))\n                .replace("{xp_remaining}", Long.toString(growth.remaining()))\n                .replace("{xp_total}", Long.toString(growth.total()))')
text=text.replace('Attribute.MAX_HEALTH','Attribute.GENERIC_MAX_HEALTH').replace('"Unchosen"','"未选职"').replace('"N/A"','"未就绪"')
(generated/'ScoreboardService.java').write_text(text,encoding='utf8')
libraries=[*(a.server/'libraries').rglob('*.jar'),*(a.server/'plugins').glob('*.jar')]
def argument_file(name,args):
 # Java argument files also carry regexes; converting every backslash to a
 # path separator silently drops the synthetic lambda methods from a patch.
 def quote(value):
  text=value.as_posix() if isinstance(value,Path) else str(value)
  return '"'+text.replace('\\','\\\\').replace('"','\\"')+'"'
 path=a.output/name;path.write_text('\n'.join(map(quote,args)),encoding='utf8');return path
def javac(name,sources,extras=()):
 cp=os.pathsep.join(map(str,[classes,*extras,*base.values(),*libraries]));args=['-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',classes,*sources]
 with(a.output/(name+'.log')).open('wb')as log:r=subprocess.run([str(a.jdk/'bin/javac.exe'),'-J-Dfile.encoding=UTF-8','-J-Duser.language=en','@'+str(argument_file(name+'.args',args))],stdout=log,stderr=subprocess.STDOUT)
 assert r.returncode==0,'Inspect '+name+'.log'
 return cp
def java(name,main,args,cp):
 return subprocess.check_output([str(a.jdk/'bin/java.exe'),'@'+str(argument_file(name+'.args',['-cp',cp,main,*args]))],text=True,encoding='utf8')
helper=here/'native-patches/io/vortexcore/rpg/ExperienceProgress.java'
cp=javac('native',[generated/'ScoreboardService.java',helper,paper/'ops/patches/CompassMethodPatch.java',here/'tests/ExperienceProgressTest.java'])
test=java('progress-test','org.qiandengji.vortex.tests.ExperienceProgressTest',[],cp);assert 'checks=11 passed=true'in test
report={'productionChanged':False,'upstream':commit,'upstreamScoreboardSha256':sha(source),'progressRules':test.strip(),'artifacts':{}}
def patch_entry(jar,entry,pattern,name):
 with zipfile.ZipFile(jar)as z:(a.output/(name+'.before')).write_bytes(z.read(entry))
 patched=a.output/(name+'.class');receipt=json.loads(java(name+'-patch','CompassMethodPatch',[a.output/(name+'.before'),classes/entry,patched,pattern],cp))
 return patched.read_bytes(),receipt
def package(kind,name,changes,version):
 out=a.output/name
 with zipfile.ZipFile(base[kind])as old,zipfile.ZipFile(out,'x',zipfile.ZIP_DEFLATED)as dest:
  extra=set(changes)-set(old.namelist())
  assert extra<=({'io/vortexcore/rpg/ExperienceProgress.class'} if kind=='native' else {'org/afuhome/agentfriend/FoundationGrowth.class','org/afuhome/agentfriend/ExistingChunkAccess.class'} if kind=='friend' else set())
  for info in old.infolist():
   data=changes.get(info.filename,old.read(info.filename))
   if info.filename=='plugin.yml':data,n=re.subn(rb'(?m)^version:.*$',('version: '+version).encode(),data);assert n==1
   if info.filename=='plugin.yml' and kind=='native':data+=b'\nqiandengji-build: qd31-growth\n'
   dest.writestr(copy.copy(info),data)
  for entry,data in changes.items():
   if entry not in old.namelist():
    info=zipfile.ZipInfo(entry,old.getinfo('plugin.yml').date_time);info.compress_type=zipfile.ZIP_DEFLATED;dest.writestr(info,data)
 with zipfile.ZipFile(base[kind])as old,zipfile.ZipFile(out)as new:
  changed=[n for n in new.namelist()if n not in old.namelist()or new.read(n)!=old.read(n)]
  assert set(changed)==set(changes)|{'plugin.yml'}
  kept=sum(old.read(n)==new.read(n)for n in old.namelist()if n in new.namelist())
 report['artifacts'][kind]={'file':str(out),'sha256':sha(out),'changedEntries':changed,'otherEntriesPreserved':kept}
 return out
entry='io/vortexcore/ui/ScoreboardService.class';data,proof=patch_entry(base['native'],entry,'updateBoard','scoreboard');report['nativeMethods']=proof
native=package('native','VortexRPG-1.2.2-alpha-qd31.jar',{entry:data,'io/vortexcore/rpg/ExperienceProgress.class':(classes/'io/vortexcore/rpg/ExperienceProgress.class').read_bytes()},'1.2.2-alpha')
cp=javac('bridge',[here/'src/org/qiandengji/vortex/VortexBridge.java',here/'src/org/qiandengji/vortex/LegacyRpgCommands.java'],[native])
entry='org/qiandengji/vortex/VortexBridge.class';data,proof=patch_entry(base['bridge'],entry,r'selfState|status|describeJourney|lambda\$describeJourney\$.*','bridge');report['bridgeMethods']=proof
assert proof['changedMethods']==12,'Expected all nine describeJourney lambdas as well as its entry point and state methods'
legacy='org/qiandengji/vortex/LegacyRpgCommands.class';legacy_data,proof=patch_entry(base['bridge'],legacy,'command','legacy-command');report['legacyMethods']=proof
bridge=package('bridge','QiandengjiRpg-0.2.13.jar',{entry:data,legacy:legacy_data},'0.2.13')
folder=paper/'plugins/AgentFriend/src/org/afuhome/agentfriend'
cp=javac('friend',[folder/(n+'.java')for n in ['AgentFriendPlugin','NativeRpg','TravelMagic','FoundationGrowth','ViewerStatePublisher','AgentCliCatalog','ExistingChunkAccess','SiteDungeonManager','ActionFeedback']],[native,bridge])
changes={};report['friendMethods']={}
for owner,pattern in [('AgentFriendPlugin','gotoPlace|statusBook|goddessSpell|castOrLearn'),('NativeRpg','commonGuide|route'),('TravelMagic','command'),('ViewerStatePublisher','buildState'),('AgentCliCatalog','catalogSpecs'),('SiteDungeonManager','travel'),('ActionFeedback','advice')]:
 entry='org/afuhome/agentfriend/'+owner+'.class';data,proof=patch_entry(base['friend'],entry,pattern,owner);changes[entry]=data;report['friendMethods'][owner]=proof
for name in ['FoundationGrowth','ExistingChunkAccess']:
 entry='org/afuhome/agentfriend/'+name+'.class';changes[entry]=(classes/entry).read_bytes()
package('friend','AgentFriend-0.4.47.37-rpg.jar',changes,'0.4.47.37-rpg')
(a.output/'build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8');print(json.dumps(report))
