"""Patch the one incompatible menu-icon method on the pinned deployed qd27 JAR."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,zipfile
p=argparse.ArgumentParser();p.add_argument('--base',type=Path,required=True);p.add_argument('--server',type=Path,required=True);p.add_argument('--jdk',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
pin='3091f10513855b6116d53534de309fdee29f8689fdcff1b184f2dadc1f51bc38';assert hashlib.sha256(a.base.read_bytes()).hexdigest()==pin and not a.output.exists()
work=a.output.parent/(a.output.stem+'.build');work.mkdir();asm=next((a.server/'libraries/org/ow2/asm/asm').glob('*/asm-*.jar'));source=Path(__file__).with_name('VortexItemModel1211.java')
subprocess.run([str(a.jdk/'bin/javac.exe'),'-proc:none','-encoding','UTF-8','-cp',str(asm),'-d',str(work),str(source)],check=True)
subprocess.run([str(a.jdk/'bin/java.exe'),'-cp',str(work)+os.pathsep+str(asm),'VortexItemModel1211',str(a.base),str(a.output)],check=True)
changed=[];retained=0
with zipfile.ZipFile(a.base)as old,zipfile.ZipFile(a.output)as new:
 assert old.namelist()==new.namelist()
 for name in old.namelist():
  if old.read(name)!=new.read(name):changed.append(name)
  else:retained+=1
assert changed==['io/vortexcore/item/CustomItemService.class']
a.output.with_suffix('.json').write_text(json.dumps({'baseSha256':pin,'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'changedEntries':changed,'retainedEntries':retained,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'productionChanged':False},indent=2)+'\n',encoding='utf8')
print(f'One Vortex method patched; {retained} other entries retained')
