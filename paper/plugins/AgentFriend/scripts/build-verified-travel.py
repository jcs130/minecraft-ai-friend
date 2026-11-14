"""Apply only this travel delta to the source of the deployed .76 artifact."""
from pathlib import Path
import argparse, difflib, hashlib, json, subprocess, zipfile
from importlib.util import spec_from_file_location, module_from_spec

p=argparse.ArgumentParser(description=__doc__)
for name in ('baseline','classpath-file','jdk','output'):p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();a.output.mkdir(parents=True)
repo=Path(__file__).resolve().parents[4]
spec=spec_from_file_location('build',Path(__file__).with_name('build-dungeon-readiness.py'));b=module_from_spec(spec);spec.loader.exec_module(b)
assert b.digest(a.baseline)=='fae5702fd21ab7aaa3ff0719cbf4b320173fa6a78dae16bf37ead33c1bcb3e8d','Deployed artifact changed'
prefix='org/afuhome/agentfriend/'
owners=('AgentFriendPlugin','GuildHallManager','TravelMagic','WaypointManager','LocationOutput','HomeLanding')
cp=str(a.baseline.resolve())+';'+a.classpath_file.read_text(encoding='utf-8-sig').strip()
old=a.output/'baseline-source';old.mkdir();new=a.output/'candidate-source';new.mkdir()
for name in owners:
 relative='paper/plugins/AgentFriend/src/'+prefix+name+'.java'
 def source(ref):return subprocess.check_output(['git','-C',str(repo),'show',ref+':'+relative]).decode().replace('\r\n','\n')
 before=source('8ed2eb9a');baseline=source('7163bba9^' if name=='GuildHallManager' else '58b417c9')
 if name=='GuildHallManager':
  prior=source('3f2995a4^').splitlines(keepends=True);updated=source('3f2995a4').splitlines(keepends=True);patches=[]
  for op,i,j,k,l in difflib.SequenceMatcher(None,prior,updated).get_opcodes():
   if op=='equal':continue
   pre=''.join(prior[max(0,i-3):i]);post=''.join(prior[j:j+3]);needle=pre+''.join(prior[i:j])+post
   assert baseline.count(needle)==1,'NPC baseline delta no longer matches'
   start=baseline.index(needle)+len(pre);patches.append((start,start+len(''.join(prior[i:j])),''.join(updated[k:l])))
  for start,end,replacement in sorted(patches,reverse=True):baseline=baseline[:start]+replacement+baseline[end:]
 (old/(name+'.java')).write_text(baseline,encoding='utf8')
 after=(repo/relative).read_text(encoding='utf8')
 left,right=before.splitlines(keepends=True),after.splitlines(keepends=True);edits=[]
 for op,i,j,k,l in difflib.SequenceMatcher(None,left,right).get_opcodes():
  if op=='equal':continue
  pre=''.join(left[max(0,i-3):i]);post=''.join(left[j:j+3]);needle=pre+''.join(left[i:j])+post
  assert baseline.count(needle)==1,'Ambiguous patch in '+name+' line '+str(i+1)
  start=baseline.index(needle)+len(pre);edits.append((start,start+len(''.join(left[i:j])),''.join(right[k:l])))
 for start,end,replacement in sorted(edits,reverse=True):baseline=baseline[:start]+replacement+baseline[end:]
 (new/(name+'.java')).write_text(baseline,encoding='utf8')
b.compile_sources(a.jdk,a.output/'baseline-classes',cp,list(old.glob('*.java')))
with zipfile.ZipFile(a.baseline) as jar:
 for file in (a.output/'baseline-classes').rglob('*.class'):
  assert jar.read(file.relative_to(a.output/'baseline-classes').as_posix())==file.read_bytes(),'Baseline source mismatch: '+file.name
(new/'TravelMarkers.java').write_bytes((repo/('paper/plugins/AgentFriend/src/'+prefix+'TravelMarkers.java')).read_bytes())
owners=(*owners,'TravelMarkers')
b.compile_sources(a.jdk,a.output/'classes',cp,list(new.glob('*.java')))
version='0.4.47.77-verified-travel';target=a.output/f'AgentFriend-{version}.jar'
b.package(a.baseline,target,a.output/'classes',prefix,owners,version)
(a.output/'build.json').write_text(json.dumps({'baselineSha256':b.digest(a.baseline),'candidateSha256':b.digest(target),'verifiedSource':'58b417c9','guildSource':{'base':'7163bba9^','delta':'3f2995a4^..3f2995a4'},'deltaBase':'8ed2eb9a','owners':owners,'productionChanged':False},indent=2))
