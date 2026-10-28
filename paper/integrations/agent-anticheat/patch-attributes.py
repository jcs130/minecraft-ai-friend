"""Narrow AGPL LAC fix: keep checks; replace async native attribute reads with tick snapshots."""
from pathlib import Path
import argparse,hashlib,json,subprocess,zipfile,os
p=argparse.ArgumentParser();p.add_argument('--base',type=Path,required=True);p.add_argument('--server',type=Path,required=True);p.add_argument('--jdk',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
assert not a.output.exists()and hashlib.sha256(a.base.read_bytes()).hexdigest()=='3faca3e44d2b54c8b2098d206d739cbba74fc27d6c70886674e3ebbe7d83414f'
root=Path(__file__).resolve().parent;work=a.output.with_suffix('.build');work.mkdir();classes=work/'classes';classes.mkdir();asm=next((a.server/'libraries').glob('org/ow2/asm/asm/9.7.1/asm-*.jar'));java=a.jdk/'bin'
def run(args):
 r=subprocess.run(args,capture_output=True)
 if r.returncode:print(r.stderr.decode('utf8',errors='replace'));raise SystemExit(r.returncode)
run([str(java/'javac.exe'),'-proc:none','--release','21','-cp',str(asm),'-d',str(classes),str(root/'PatchAttributeSnapshots.java')])
entry='me/vekster/multiversion/V1_20.class'
with zipfile.ZipFile(a.base)as z:(work/'before.class').write_bytes(z.read(entry))
target=classes/entry;target.parent.mkdir(parents=True)
run([str(java/'java.exe'),'-cp',str(classes)+os.pathsep+str(asm),'PatchAttributeSnapshots',str(work/'before.class'),str(target)])
cp=os.pathsep.join(map(str,[classes,a.base,*sorted((a.server/'libraries').rglob('*.jar'))]))
run([str(java/'javac.exe'),'-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',str(classes),str(root/'AttributeSnapshots.java')])
new={f.relative_to(classes).as_posix():f.read_bytes()for f in classes.rglob('*.class')if not f.name.startswith('PatchAttribute')};assert entry in new
retained=0
with zipfile.ZipFile(a.base)as src,zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED)as z:
 for item in src.infolist():
  if item.filename in new:continue
  data=src.read(item)
  if item.filename=='plugin.yml':assert b'1.2.6-qd1'in data;data=data.replace(b'1.2.6-qd1',b'1.2.6-qd2')
  else:retained+=1
  z.writestr(item,data)
 for name,data in new.items():z.writestr(name,data)
a.output.with_suffix('.json').write_text(json.dumps({'baseSha256':hashlib.sha256(a.base.read_bytes()).hexdigest(),'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'changedClasses':sorted(new),'retainedEntries':retained,'license':'AGPL-3.0-only','source':'https://github.com/tiredvekster/LightAntiCheat/tree/ec801a0eca80aa8d53587411e643bead7c8bdb1a','productionChanged':False},indent=2)+'\n',encoding='utf8')
print('Built LAC qd2 snapshots; check classes and enforcement retained')
