"""Patch a digest-pinned candidate only; native mana/skills keep their existing authority."""
from pathlib import Path
import argparse,hashlib,os,subprocess,tempfile,zipfile,json
p=argparse.ArgumentParser(description=__doc__)
for key in ('base','server','jdk','output'):p.add_argument('--'+key,type=Path,required=True)
p.add_argument('--base-sha256',required=True);a=p.parse_args()
assert hashlib.sha256(a.base.read_bytes()).hexdigest()==a.base_sha256,'base digest mismatch'
assert not a.output.resolve().is_relative_to((a.server/'plugins').resolve()),'candidate output required'
root=Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='vortex-residents-')as d:
 work=Path(d);classes=work/'classes';classes.mkdir()
 with zipfile.ZipFile(a.base)as z:entries={n:z.read(n)for n in z.namelist()if not n.endswith('/')}
 for name,value in entries.items():
  if name.startswith('io/vortexcore/rpg/SpellbookService')and name.endswith('.class')or name=='io/vortexcore/combat/ManaManager.class':
   target=classes/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(value)
 cp=os.pathsep.join(map(str,[a.base,*a.server.glob('libraries/**/*.jar')]))
 arguments=['--release','21','-encoding','UTF-8','-proc:none','-cp',cp,'-d',str(classes),str(root/'native-patches/ResidentActorsPatch.java'),str(root/'native-patches/io/vortexcore/rpg/ResidentActors.java'),str(root/'native-patches/io/vortexcore/combat/PartySpellTargets.java')]
 opts=work/'compile.args';opts.write_text('\n'.join('"'+s.replace('\\','/')+'"'for s in arguments),encoding='utf8')
 subprocess.run([str(a.jdk/'bin/javac.exe'),'@'+str(opts)],check=True)
 subprocess.run([str(a.jdk/'bin/java.exe'),'-cp',str(classes)+os.pathsep+cp,'ResidentActorsPatch',str(classes)],check=True)
 changed=[]
 for f in(classes/'io/vortexcore').rglob('*.class'):
  name=f.relative_to(classes).as_posix();value=f.read_bytes()
  if entries.get(name)!=value:changed.append(name);entries[name]=value
 a.output.parent.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED)as z:
  for name,value in entries.items():z.writestr(name,value)
 report={'baseSha256':a.base_sha256,'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'changedEntries':sorted(changed),'productionChanged':False}
 a.output.with_suffix('.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))
