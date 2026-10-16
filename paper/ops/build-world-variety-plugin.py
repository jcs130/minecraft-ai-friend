from pathlib import Path
import argparse,subprocess,zipfile,json,hashlib
p=argparse.ArgumentParser();p.add_argument('--libraries',type=Path,required=True);p.add_argument('--plugins',type=Path,required=True);p.add_argument('--java-home',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--classes',type=Path,required=True)
a=p.parse_args();source=Path(__file__).parents[1]/'plugins/WorldVariety';a.classes.mkdir(parents=True,exist_ok=False);assert not a.output.exists()
jars=sorted(a.libraries.rglob('*.jar'))+sorted(a.plugins.glob('*.jar'));cp=';'.join(x.resolve().as_posix()for x in jars)
arguments=['-proc:none','-encoding','UTF-8','-cp',cp,'-d',a.classes.resolve().as_posix()]+[x.resolve().as_posix()for x in source.rglob('*.java')]
argfile=a.classes/'javac.args';argfile.write_text('\n'.join('"'+x.replace('\\','/')+'"'for x in arguments),encoding='utf-8')
subprocess.run([str(a.java_home/'bin/javac.exe'),'@'+str(argfile)],check=True)
with zipfile.ZipFile(a.output,'x',compression=zipfile.ZIP_DEFLATED)as z:
 for name in['plugin.yml','config.yml']:
  info=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,(source/name).read_bytes())
 for file in sorted(a.classes.rglob('*.class')):
  info=zipfile.ZipInfo(file.relative_to(a.classes).as_posix(),date_time=(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,file.read_bytes())
print(json.dumps({'file':a.output.name,'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest()}))
