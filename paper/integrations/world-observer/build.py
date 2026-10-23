"""Build an independent observer; never patches AgentFriend or installs a JAR."""
from pathlib import Path
import argparse,subprocess,zipfile,hashlib,json,os
p=argparse.ArgumentParser()
p.add_argument('--server',type=Path,required=True)
p.add_argument('--jdk',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
a=p.parse_args();root=Path(__file__).resolve().parent
a.output.mkdir(parents=True,exist_ok=False)
cp=[a.server/'versions/1.21.1/paper-1.21.1.jar',a.server/'plugins/ProtocolLib-5.3.0.jar',*sorted((a.server/'libraries').rglob('*.jar'))]
classes=a.output/'classes';classes.mkdir()
args=['-proc:none','-encoding','UTF-8','--release','21','-cp',os.pathsep.join(str(f.resolve()) for f in cp),'-d',str(classes.resolve()),*map(str,sorted((root/'src').rglob('*.java')))]
af=a.output/'javac.args';af.write_text('\n'.join('"'+v.replace('\\','/')+'"' for v in args),encoding='utf8')
subprocess.run([str(a.jdk/'bin'/('javac.exe' if os.name=='nt' else 'javac')),'@'+str(af)],check=True)
jar=a.output/'WorldObserver-0.1.0.jar'
with zipfile.ZipFile(jar,'x',compression=zipfile.ZIP_DEFLATED) as z:
 for f in sorted(classes.rglob('*.class')):z.write(f,f.relative_to(classes).as_posix())
 for name in ['plugin.yml','config.yml']:z.write(root/name,name)
record={'jar':jar.name,'sha256':hashlib.sha256(jar.read_bytes()).hexdigest(),'installed':False}
(a.output/'build.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf8')
print(json.dumps(record))
