"""Narrow target validation on qd28, retaining native refund/cooldown handling."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,zipfile
p=argparse.ArgumentParser();p.add_argument('--base',type=Path,required=True);p.add_argument('--server',type=Path,required=True);p.add_argument('--jdk',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
pin='538726562c443a791cacf71782d68ea8658ebb8c063b7a17dc9be662c73e79bd';assert not a.output.exists()and hashlib.sha256(a.base.read_bytes()).hexdigest()==pin
root=Path(__file__).resolve().parent;work=a.output.parent/(a.output.stem+'.build');work.mkdir();asm=next((a.server/'libraries/org/ow2/asm/asm').glob('*/asm-*.jar'));sources=list((root/'cast-targets').glob('*.java'))
subprocess.run([str(a.jdk/'bin/javac.exe'),'-proc:none','-encoding','UTF-8','-cp',str(asm),'-d',str(work),*map(str,sources)],check=True)
subprocess.run([str(a.jdk/'bin/java.exe'),'-cp',str(work)+os.pathsep+str(asm),'PatchCastTargets',str(a.base),str(a.output),str(work/'io/vortexcore/combat/NativeCastTargets.class')],check=True)
with zipfile.ZipFile(a.base)as old,zipfile.ZipFile(a.output)as new:
 changed=[name for name in old.namelist()if old.read(name)!=new.read(name)];added=set(new.namelist())-set(old.namelist())
 assert changed==['io/vortexcore/rpg/SpellbookService$SimpleCompiledSpell.class']and added=={'io/vortexcore/combat/NativeCastTargets.class'}
 report={'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'baseSha256':pin,'changedEntries':changed,'addedEntries':sorted(added),'retainedEntries':len(old.namelist())-1,'productionChanged':False}
a.output.with_suffix('.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8');print('Patched empty-target fallback only; native failed-cast refund path retained')
