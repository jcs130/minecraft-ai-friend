"""Add the native-maid ASR callback without replacing unrelated deployed voice classes."""
import argparse,hashlib,subprocess,tempfile,zipfile
from pathlib import Path
BASE='60cc4c60f81f9828bf56812012220087a31b1b85e92f52df3a9a58a549bfc94f'
def main():
 p=argparse.ArgumentParser();p.add_argument('--baseline',type=Path,required=True);p.add_argument('--classpath-file',type=Path,required=True);p.add_argument('--svc',type=Path,required=True);p.add_argument('--javac',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 assert a.baseline.resolve()!=a.output.resolve() and hashlib.sha256(a.baseline.read_bytes()).hexdigest()==BASE
 a.output.parent.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(dir=a.output.parent,prefix='maid-caption-build-') as tmp:
  root=Path(tmp);cp=str(a.baseline.resolve())+';'+str(a.svc.resolve())+';'+a.classpath_file.read_text(encoding='utf-8-sig').strip()
  values=['--release','21','-encoding','UTF-8','-proc:none','-classpath',cp,'-d',str(root/'classes'),str(Path(__file__).parent/'src/dev/god/godvoice/PaperVoicePlugin.java')]
  (root/'args').write_text('\n'.join('"'+s.replace('\\','/')+'"' for s in values),encoding='utf-8');subprocess.run([str(a.javac),'@'+str(root/'args')],check=True)
  prefix='dev/god/godvoice/PaperVoicePlugin';replaced=lambda n:n==prefix+'.class' or n.startswith(prefix+'$')
  with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED) as new:
   for item in old.infolist():
    if replaced(item.filename):continue
    data=old.read(item.filename)
    if item.filename=='plugin.yml':data=data.replace(b'version: 0.1.3',b'version: 0.1.4')
    new.writestr(item,data)
   for file in sorted((root/'classes').rglob('*.class')):
    item=zipfile.ZipInfo(file.relative_to(root/'classes').as_posix(),(2026,11,7,0,0,0));item.compress_type=zipfile.ZIP_DEFLATED;new.writestr(item,file.read_bytes())
  with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(a.output) as new:
   kept=[n for n in old.namelist() if n!='plugin.yml' and not replaced(n)];assert all(old.read(n)==new.read(n) for n in kept)
  print(f'{a.output.name}: {hashlib.sha256(a.output.read_bytes()).hexdigest()}; {len(kept)} unrelated entries preserved')
if __name__=='__main__':main()
