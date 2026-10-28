"""Build only our API adapter. Never redistributes Vortex or a live config."""
from pathlib import Path
import argparse,os,subprocess,zipfile
p=argparse.ArgumentParser();p.add_argument('--server',type=Path,required=True);p.add_argument('--vortex',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
assert not a.output.exists(),'new output required'
root=Path(__file__).resolve().parent;java=Path('E:/MC/jdk/jdk-21.0.12.1+1/bin');classes=a.output.parent/(a.output.stem+'.build')/'classes';classes.mkdir(parents=True)
cp=os.pathsep.join(map(str,[a.vortex,a.server/'plugins/Vault-1.7.3.jar',*a.server.rglob('libraries/**/*.jar')]))
result=subprocess.run([str(java/'javac.exe'),'-J-Duser.language=en','-J-Dfile.encoding=UTF-8','-proc:none','-encoding','UTF-8','--release','21','-cp',cp,'-d',str(classes),*map(str,(root/'src').rglob('*.java'))],capture_output=True)
if result.returncode:
 print(result.stderr.decode('utf8',errors='replace'));raise SystemExit(result.returncode)
with zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED)as z:
 for base in [classes,root/'resources']:
  for f in base.rglob('*'):
   if f.is_file():z.write(f,f.relative_to(base).as_posix())
print(a.output.name)
