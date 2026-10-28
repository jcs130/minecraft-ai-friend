"""Compile/run focused grammar, current discovery and existing CLI regression tests."""
from pathlib import Path
import argparse,subprocess,os,json
p=argparse.ArgumentParser();p.add_argument('--server',type=Path,required=True);p.add_argument('--af',type=Path,required=True);p.add_argument('--bridge',type=Path,required=True);p.add_argument('--vortex',type=Path,required=True);p.add_argument('--jdk',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
assert not a.output.exists();a.output.mkdir(parents=True);paper=Path(__file__).resolve().parents[2]
cp=os.pathsep.join(map(str,[a.af,a.bridge,a.vortex,*sorted((a.server/'libraries').rglob('*.jar')),*sorted((a.server/'versions').rglob('*.jar'))]))
tests=[*[paper/'integrations/vortex-rpg/tests'/n for n in ['AgentGrammarTest.java','RulesTest.java','ItemModel1211Test.java']],*[paper/'plugins/AgentFriend/tests/org/afuhome/agentfriend'/n for n in ['NativeCliCatalogTest.java','AgentCliContractTest.java','AgentCliTextTest.java']]]
args=['-proc:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',str(a.output),*map(str,tests)];arg=a.output/'javac.args';arg.write_text('\n'.join('"'+s.replace('\\','/')+'"'for s in args),encoding='utf8')
r=subprocess.run([str(a.jdk/'bin/javac.exe'),'@'+str(arg)],capture_output=True)
if r.returncode:print(r.stderr.decode('utf8',errors='replace'));raise SystemExit(r.returncode)
results={}
for name in ['AgentGrammarTest','RulesTest','ItemModel1211Test','org.afuhome.agentfriend.NativeCliCatalogTest','org.afuhome.agentfriend.AgentCliContractTest','org.afuhome.agentfriend.AgentCliTextTest']:
 argv=[str(a.jdk/'bin/java.exe'),'-cp',str(a.output)+os.pathsep+cp,name]
 if name.endswith('AgentCliTextTest'):argv.append(str(paper/'plugins/AgentFriend/build-current'))
 r=subprocess.run(argv,capture_output=True,text=True,encoding='utf8',errors='replace');results[name]={'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr};print(name,r.returncode,r.stdout,r.stderr if r.returncode else '')
(a.output/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8');assert all(v['exit']==0 for v in results.values())
