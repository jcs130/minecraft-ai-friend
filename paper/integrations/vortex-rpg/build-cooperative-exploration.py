"""Build reviewed party and exploration changes; produce candidates, never install or edit players."""
from pathlib import Path
import argparse,copy,hashlib,json,os,re,subprocess,zipfile

p=argparse.ArgumentParser(description=__doc__)
for name in ['server','native-source','jdk','base-friend','output']:p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();here=Path(__file__).resolve().parent;paper=here.parents[1]
base={'native':a.server/'plugins/VortexRPG-1.2.2-alpha-qd29.jar','bridge':a.server/'plugins/QiandengjiRpg-0.2.10.jar','friend':a.base_friend}
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
pins={'native':'4751b69a677b33d35be859de405929b31e8f36b3a0254d7ab2c2b650a6c495d4','bridge':'5c091bc967d8041c2669abfcf9164bb4c810cdce2fe89004def5b664f37c1257','friend':'dac1286d7193bc533a0b6b7b0cbc6de161c02a27087649c73802f2ec685bd4a1'}
assert all(sha(base[k])==value for k,value in pins.items()),'Explicitly rebase changed native artifacts'
a.output.mkdir(exist_ok=False,parents=True);classes=a.output/'classes';classes.mkdir()
source=a.native_source/'src/main/java/io/vortexcore/world/ExpeditionPartyManager.java'
assert sha(source)=='029f8e97ed07f4f2103c8554893e8755660e6ca58a388b8063d65e6115be3964'
text=source.read_text();needle='    public Collection<PartySnapshot> allParties() {';assert text.count(needle)==1
addition='''    /** Read-only: expired invites are reported absent without consuming or replacing them. */
    public Optional<InviteSnapshot> pendingInviteOf(UUID targetId) {
        PartyInvite invite = targetId == null ? null : pendingInvites.get(targetId);
        if (invite == null || invite.expiresAtEpochMillis <= System.currentTimeMillis() || !parties.containsKey(invite.partyId)) return Optional.empty();
        return Optional.of(new InviteSnapshot(invite.partyId, invite.inviterId, invite.targetId, invite.expiresAtEpochMillis));
    }
    public record InviteSnapshot(UUID partyId, UUID inviterId, UUID targetId, long expiresAtEpochMillis) {}

'''
generated=a.output/'generated/io/vortexcore/world/ExpeditionPartyManager.java';generated.parent.mkdir(parents=True);generated.write_text(text.replace(needle,addition+needle),encoding='utf-8')
libs=[*a.server.glob('libraries/**/*.jar'),*a.server.glob('plugins/*.jar')];suffix='.exe'if os.name=='nt'else''
def argfile(name,values):
 f=a.output/(name+'.args');f.write_text('\n'.join('"'+str(x).replace('\\','/')+'"'for x in values),encoding='utf-8');return '@'+str(f)
def compile(name,sources,extra=[]):
 cp=os.pathsep.join(map(str,[classes,*extra,*base.values(),*libs]))
 with(a.output/(name+'.log')).open('wb')as log:r=subprocess.run([str(a.jdk/('bin/javac'+suffix)),argfile(name,['-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',classes,*sources])],stdout=log,stderr=subprocess.STDOUT)
 assert r.returncode==0,'Inspect '+name+'.log'
 return cp
def java(name,main,args,cp):return subprocess.check_output([str(a.jdk/('bin/java'+suffix)),argfile(name,['-ea','-cp',cp,main,*args])],text=True,encoding='utf-8')
report={'productionChanged':False,'baseSha256':pins,'nativeSourceSha256':sha(source),'artifacts':{},'friendMethods':{}}
def package(kind,name,changes,version,build=None):
 output=a.output/name
 with zipfile.ZipFile(base[kind])as old,zipfile.ZipFile(output,'x',zipfile.ZIP_DEFLATED)as new:
  descriptor=old.read('plugin.yml');descriptor,count=re.subn(rb'(?m)^version:.*$',('version: '+version).encode(),descriptor);assert count==1
  if build:descriptor=re.sub(rb'(?m)^qiandengji-build:.*\r?\n?',b'',descriptor)+('\nqiandengji-build: '+build+'\n').encode()
  changes['plugin.yml']=descriptor
  for info in old.infolist():new.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
  for entry,data in changes.items():
   if entry not in old.namelist():new.writestr(entry,data)
 with zipfile.ZipFile(base[kind])as old,zipfile.ZipFile(output)as new:
  changed={n for n in new.namelist()if n not in old.namelist()or new.read(n)!=old.read(n)};assert changed==set(changes)
  report['artifacts'][kind]={'file':str(output),'sha256':sha(output),'changedEntries':sorted(changed),'otherEntriesPreserved':len(old.namelist())-len(set(changes)&set(old.namelist()))}
 return output
cp=compile('native',[generated,paper/'ops/patches/CompassMethodPatch.java',paper/'ops/patches/PartyObservationPatch.java',here/'tests/NativePartyInviteTest.java'])
report['inviteRules']=java('invite-rules','org.qiandengji.vortex.tests.NativePartyInviteTest',[],cp).strip()
native_changes={n:(classes/n).read_bytes()for n in ['io/vortexcore/world/ExpeditionPartyManager.class','io/vortexcore/world/ExpeditionPartyManager$InviteSnapshot.class']}
native=package('native','VortexRPG-1.2.2-alpha-qd32-cooperation.jar',native_changes,'1.2.2-alpha','qd32-cooperation')
cp=compile('bridge',[here/'src/org/qiandengji/vortex'/(n+'.java')for n in ['VortexBridge','NativeParties','NativePartyView']],[native])
bridge=package('bridge','QiandengjiRpg-0.2.14.jar',{'org/qiandengji/vortex/'+n+'.class':(classes/('org/qiandengji/vortex/'+n+'.class')).read_bytes()for n in ['VortexBridge','NativeParties','NativePartyView']},'0.2.14')
folder=paper/'plugins/AgentFriend/src/org/afuhome/agentfriend'
owners=['AgentFriendPlugin','NativeRpg','SpellGuide','AgentCliCatalog','GuildManager','TaskGuidance','TaskProgressGuidance','TaskMarketManager']
cp=compile('friend',[*[folder/(n+'.java')for n in owners],folder/'PeakSurvey.java',folder/'PartyObservation.java',folder/'TeamTravelSafety.java',here/'tests/PeakSurveyTest.java'],[native,bridge])
report['terrainRules']=java('terrain-rules','org.afuhome.agentfriend.PeakSurveyTest',[],cp).strip()
changes={}
for owner,pattern in [('AgentFriendPlugin','guide|readBasicCooldown|safeNear|teleportToTeammate'),('NativeRpg','<clinit>|route|skillId'),('SpellGuide','<clinit>|find'),('AgentCliCatalog','createSpecs|catalogSpecs'),('GuildManager','<clinit>|progressState|showPeakRequirement|checkExplore|onExploreTeleport|poolIds'),('TaskGuidance','step'),('TaskProgressGuidance','instruction'),('TaskMarketManager','progressState|detail|send')]:
 entry='org/afuhome/agentfriend/'+owner+'.class'
 with zipfile.ZipFile(base['friend'])as z:(a.output/(owner+'.before')).write_bytes(z.read(entry))
 output=a.output/(owner+'.patched.class')
 proof=java(owner+'-patch','CompassMethodPatch',[a.output/(owner+'.before'),classes/entry,output,pattern],cp)
 report['friendMethods'][owner]=json.loads(proof);changes[entry]=output.read_bytes()
entry='org/afuhome/agentfriend/AgentFriendPlugin.class';before=a.output/'roster.before';before.write_bytes(changes[entry])
report['rosterLabelPatch']=json.loads(java('roster-patch','PartyObservationPatch',[before,a.output/'roster.patched.class','roster-label'],cp));changes[entry]=(a.output/'roster.patched.class').read_bytes()
entry='org/afuhome/agentfriend/GoddessObservation.class'
with zipfile.ZipFile(base['friend'])as z:(a.output/'observation.before').write_bytes(z.read(entry))
report['observationPatch']=json.loads(java('observation-patch','PartyObservationPatch',[a.output/'observation.before',a.output/'observation.patched.class'],cp));changes[entry]=(a.output/'observation.patched.class').read_bytes()
for name in ['PeakSurvey','PeakSurvey$Result','PartyObservation','TeamTravelSafety']:
 entry='org/afuhome/agentfriend/'+name+'.class';changes[entry]=(classes/entry).read_bytes()
package('friend','AgentFriend-0.4.47.39-rpg.jar',changes,'0.4.47.39-rpg')
(a.output/'build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
