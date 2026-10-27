"""Build a narrow AgentFriend/Vortex takeover candidate from a pinned .20 base.

No deployment, player migration, third-party download or mutable live inputs.
"""
from pathlib import Path
import argparse, hashlib, json, os, subprocess, zipfile

BASE_SHA='5b8344fd26a6a8c719f086024b1322b566634e4baba7d1c359a45f8574b63593'
OWNERS=('AgentFriendPlugin','NativeRpg','ProfessionLedger','ProfessionManager',
        'AgentCommunication','AgentStatePublisher','ViewerStatePublisher',
        'AgentAbilityState','AgentEntry','CombatRpg','OnboardingGuide','DungeonAdvice')

def main():
 p=argparse.ArgumentParser();p.add_argument('--base',type=Path,required=True);p.add_argument('--server',type=Path,required=True)
 p.add_argument('--java',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 if a.output.exists() or hashlib.sha256(a.base.read_bytes()).hexdigest()!=BASE_SHA:raise ValueError('Requires an unused output and pinned .20 base')
 root=Path(__file__).resolve().parents[2]/'plugins/AgentFriend';build=a.output.parent/(a.output.stem+'.build');build.mkdir(parents=True)
 classes=build/'classes';classes.mkdir();empty=build/'empty';empty.mkdir()
 cp=os.pathsep.join(map(str,[a.base,*sorted((a.server/'libraries').rglob('*.jar')),*sorted((a.server/'versions').rglob('*.jar')),*sorted((a.server/'plugins').glob('*.jar'))]))
 sources=[root/'src/org/afuhome/agentfriend'/f'{x}.java' for x in OWNERS]
 args=['-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-sourcepath',str(empty),'-cp',cp,'-d',str(classes),*map(str,sources)]
 argfile=build/'javac.args';argfile.write_text('\n'.join('"'+s.replace('\\','/')+'"' for s in args),encoding='utf8')
 r=subprocess.run([str(a.java/'javac.exe'),'@'+str(argfile)],capture_output=True)
 (build/'javac.stderr').write_bytes(r.stderr)
 if r.returncode:print(r.stderr.decode('utf8',errors='replace'));raise SystemExit(r.returncode)
 prefix='org/afuhome/agentfriend/'
 def owned(name):return any(name==prefix+x+'.class' or name.startswith(prefix+x+'$') for x in OWNERS)
 new={f.relative_to(classes).as_posix():f.read_bytes() for f in classes.rglob('*.class')}
 assert all(owned(n) for n in new)
 retained=0
 with zipfile.ZipFile(a.base) as old,zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED) as out:
  for i in old.infolist():
   if owned(i.filename):continue
   data=old.read(i)
   if i.filename=='plugin.yml':data=data.replace(b'0.4.47.20',b'0.4.47.21-vortex-candidate')
   else:retained+=1
   out.writestr(i,data)
  for name,data in new.items():out.writestr(name,data)
 result={'baseSha256':BASE_SHA,'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'owners':OWNERS,'changedClasses':sorted(new),'otherEntriesRetained':retained,'productionChanged':False}
 a.output.with_suffix('.json').write_text(json.dumps(result,indent=2),encoding='utf8');print(json.dumps({'classes':len(new),'retained':retained}))
if __name__=='__main__':main()
