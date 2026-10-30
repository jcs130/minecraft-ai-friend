"""Build only the tracking compatibility plugin, preserving current resources."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,zipfile
p=argparse.ArgumentParser();p.add_argument('--server',type=Path,required=True);p.add_argument('--paper-jar',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--jdk',type=Path,required=True);a=p.parse_args()
baseline=a.server/'plugins/AgentVision-0.1.2.jar'
assert hashlib.sha256(baseline.read_bytes()).hexdigest()=='e7e0b46c9bc9df9ea8f8e7ba00dbe7df8e415ac8eea00aed32cf4c21c1a10a65'
a.output.mkdir(parents=True,exist_ok=False)
src=Path(__file__).resolve().parents[1]/'plugins/AgentVision';classes=a.output/'classes';classes.mkdir()
cp=os.pathsep.join(str(x.resolve())for x in [a.paper_jar,*(a.server/'libraries').rglob('*.jar'),*(a.server/'plugins').glob('*.jar')])
args=['-proc:none','-implicit:none','-encoding','UTF-8','--release','21','-cp',cp,'-d',str(classes),*map(str,(src/'src').rglob('*.java'))]
argfile=a.output/'javac.args';argfile.write_text('\n'.join('"'+v.replace('\\','/')+'"'for v in args),encoding='utf-8')
subprocess.run([str(a.jdk/'bin/javac.exe'),'@'+str(argfile)],check=True)
entries={f.relative_to(classes).as_posix():f.read_bytes()for f in classes.rglob('*.class')};assert len(entries)==5
entries['paper-plugin.yml']=(src/'paper-plugin.yml').read_bytes()
candidate=a.output/'AgentVision-0.1.4.jar';kept=[]
with zipfile.ZipFile(baseline)as before,zipfile.ZipFile(candidate,'x',zipfile.ZIP_DEFLATED)as after:
    for name in before.namelist():
        if name not in entries:kept.append(name)
        after.writestr(name,entries.pop(name,before.read(name)))
    for name,data in entries.items():after.writestr(name,data)
report={'candidate':str(candidate),'sha256':hashlib.sha256(candidate.read_bytes()).hexdigest(),'preservedResources':kept,'version':'0.1.4','productionWritten':False}
(a.output/'build.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
