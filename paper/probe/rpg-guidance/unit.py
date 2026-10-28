"""Run the pure transition and patched-LAC thread-boundary checks; no game connection."""
from pathlib import Path
import argparse,subprocess,os,json
p=argparse.ArgumentParser();p.add_argument('--server',type=Path,required=True);p.add_argument('--lac',type=Path,required=True);p.add_argument('--jdk',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
assert not a.output.exists(),'use a new test output directory';a.output.mkdir(parents=True)
paper=Path(__file__).resolve().parents[2];java=a.jdk/'bin';suffix='.exe'if os.name=='nt'else''
cp=os.pathsep.join(map(str,[a.lac,*sorted((a.server/'versions').rglob('*.jar')),*sorted((a.server/'libraries').rglob('*.jar'))]))
files=[paper/'integrations/agent-anticheat/tests/AttributeSnapshotsTest.java',paper/'integrations/vortex-rpg/tests/SkillTransitionTest.java',paper/'integrations/vortex-rpg/src/org/qiandengji/vortex/SkillTransition.java']
args=['-proc:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',str(a.output),*map(str,files)]
arg=a.output/'javac.args';arg.write_text('\n'.join('"'+s.replace('\\','/')+'"'for s in args),encoding='utf8')
subprocess.run([str(java/('javac'+suffix)),'@'+str(arg)],check=True)
results={}
for name in ['SkillTransitionTest','AttributeSnapshotsTest']:
 r=subprocess.run([str(java/('java'+suffix)),'-cp',str(a.output)+os.pathsep+cp,name],capture_output=True,text=True,encoding='utf8',errors='replace');results[name]={'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr};print(name,r.returncode,r.stdout)
(a.output/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')
assert all(r['exit']==0 for r in results.values())
