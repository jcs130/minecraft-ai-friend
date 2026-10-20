"""Build the optional metadata bridge only. Never rebuild or release the held Freesia af4 candidate."""
from pathlib import Path
import argparse,hashlib,json,subprocess,zipfile
root=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--jdk',type=Path,required=True)
parser.add_argument('--classpath',nargs='+',type=Path,required=True)
args=parser.parse_args()
out=args.output.resolve()
assert not out.exists() and not out.is_relative_to(root),'fresh external build directory required'
classes=out/'classes';classes.mkdir(parents=True)
sources=list((root/'bridge').rglob('*.java'))
cp=';'.join(map(str,args.classpath))
subprocess.run([str(args.jdk/'bin/javac.exe'),'-proc:none','-encoding','UTF-8','--release','21','-cp',cp,'-d',str(classes),*map(str,sources)],check=True)
test=root/'tests/org/afuhome/appearance/NativeCompanionsTest.java'
subprocess.run([str(args.jdk/'bin/javac.exe'),'-proc:none','-encoding','UTF-8','--release','21','-cp',str(classes)+';'+cp,'-d',str(out/'tests'),str(test)],check=True)
subprocess.run([str(args.jdk/'bin/java.exe'),'-cp',str(out/'tests')+';'+str(classes)+';'+cp,'org.afuhome.appearance.NativeCompanionsTest'],check=True)
jar=out/'AgentAppearance-0.3.3.jar'
with zipfile.ZipFile(jar,'w',zipfile.ZIP_DEFLATED) as dst:
    for p in classes.rglob('*.class'):dst.writestr(p.relative_to(classes).as_posix(),p.read_bytes())
    dst.writestr('velocity-plugin.json',json.dumps(dict(id='agentappearance',name='AgentAppearance',version='0.3.3',main='org.afuhome.appearance.AppearanceBridge',dependencies=[dict(id='freesia',optional=False),dict(id='packetevents',optional=False)])))
record=dict(output=jar.name,sha256=hashlib.sha256(jar.read_bytes()).hexdigest(),sources={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},dependencies={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in args.classpath},freesiaJarRebuilt=False)
(out/'build-manifest.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
print(json.dumps(dict(output=str(jar),sha256=record['sha256'],freesiaJarRebuilt=False)))
