"""Build and test the small Velocity capability guard without installation or downloads."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,zipfile

parser=argparse.ArgumentParser(description=__doc__)
for key in ['output','jdk','velocity','packetevents']:parser.add_argument('--'+key,type=Path,required=True)
args=parser.parse_args();root=Path(__file__).resolve().parent
out=args.output.resolve();out.mkdir(parents=True,exist_ok=False)
classes=out/'classes';classes.mkdir();cp=os.pathsep.join(map(str,[args.velocity,args.packetevents]))
sources=[*root.glob('src/**/*.java'),*root.glob('tests/**/*.java')]
subprocess.run([args.jdk/'bin/javac.exe','-proc:none','-encoding','UTF-8','--release','21','-cp',cp,'-d',classes,*sources],check=True)
test=subprocess.run([args.jdk/'bin/java.exe','-ea','-cp',str(classes)+os.pathsep+cp,'org.qiandengji.payload.OptionalPayloadPolicyTest'],check=True,capture_output=True,text=True,encoding='utf-8')
(out/'tests.txt').write_text(test.stdout,encoding='utf-8')
jar=out/'OptionalPayloadGuard-0.1.0.jar'
with zipfile.ZipFile(jar,'x',zipfile.ZIP_DEFLATED)as archive:
 for file in classes.rglob('*.class'):
  if 'Test' not in file.name:archive.write(file,file.relative_to(classes).as_posix())
 archive.writestr('velocity-plugin.json',json.dumps({'id':'optionalpayloadguard','name':'OptionalPayloadGuard','version':'0.1.0','main':'org.qiandengji.payload.OptionalPayloadGuard','dependencies':[{'id':'packetevents','optional':False}]}))
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
record={'artifact':jar.name,'sha256':sha(jar),'sources':{str(p.relative_to(root)):sha(p)for p in sources},'dependencies':{p.name:sha(p)for p in [args.velocity,args.packetevents]},'tests':test.stdout.strip(),'productionChanged':False}
(out/'build.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8');print(json.dumps(record))
