"""Patch only the pinned qd29 join/save lifecycle. No deployment or player data input."""
from pathlib import Path
import argparse, hashlib, json, os, shutil, subprocess, zipfile
p=argparse.ArgumentParser();p.add_argument('--base',type=Path,required=True);p.add_argument('--server',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--java-home',type=Path,default=os.environ.get('JAVA_HOME'));a=p.parse_args()
assert hashlib.sha256(a.base.read_bytes()).hexdigest()=='e16481eabaee1e18cdaaa6d230bfef65bd7e1178247a703215c3bf9b91119d8d'
assert not a.output.exists() and a.server.resolve() not in a.output.resolve().parents
root=Path(__file__).parent;build=a.output.parent/(a.output.stem+'.build');build.mkdir();classes=build/'classes';classes.mkdir()
cp=os.pathsep.join(map(str,[a.base,*sorted((a.server/'libraries').rglob('*.jar')),*sorted((a.server/'versions').rglob('*.jar'))]))
sources=[root/'native-patches/ProfileLifecyclePatch.java',root/'native-patches/io/vortexcore/rpg/ProfileJoinDispatch.java',root/'tests/ProfileJoinDispatchTest.java',root/'tests/ProfileLoadingSaveTest.java']
args=['-proc:none','-encoding','UTF-8','--release','21','-cp',cp,'-d',str(classes),*map(str,sources)]
af=build/'javac.args';af.write_text('\n'.join('"'+s.replace('\\','/')+'"'for s in args),encoding='utf8')
jdk=a.java_home/'bin' if a.java_home else Path(shutil.which('javac') or 'javac').resolve().parent
suffix='.exe' if os.name=='nt' else ''
result=subprocess.run([str(jdk/('javac'+suffix)),'-J-Duser.language=en','-J-Dfile.encoding=UTF-8','@'+str(af)],capture_output=True)
(build/'compile.log').write_bytes(result.stdout+result.stderr)
if result.returncode:print(result.stderr.decode(errors='replace'));raise SystemExit(result.returncode)
target='io/vortexcore/rpg/PlayerProfileService.class'
with zipfile.ZipFile(a.base)as z:(build/'original.class').write_bytes(z.read(target))
result=subprocess.run([str(jdk/('java'+suffix)),'-cp',str(classes)+os.pathsep+cp,'ProfileLifecyclePatch',str(build/'original.class'),str(build/'patched.class')],capture_output=True)
(build/'patch.log').write_bytes(result.stdout+result.stderr)
if result.returncode:print(result.stderr.decode(errors='replace'));raise SystemExit(result.returncode)
kept=[]
with zipfile.ZipFile(a.base)as old,zipfile.ZipFile(a.output,'x',zipfile.ZIP_DEFLATED)as out:
 for item in old.infolist():
  if item.filename==target:out.writestr(item,(build/'patched.class').read_bytes())
  else:out.writestr(item,old.read(item));kept.append(item.filename)
 out.write(classes/'io/vortexcore/rpg/ProfileJoinDispatch.class','io/vortexcore/rpg/ProfileJoinDispatch.class')
with zipfile.ZipFile(a.base)as old,zipfile.ZipFile(a.output)as new:
 for name in kept:assert old.read(name)==new.read(name),name
report={'version':'1.2.2-alpha-qd30','baseSha256':hashlib.sha256(a.base.read_bytes()).hexdigest(),'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'preservedEntries':len(kept),'modifiedClasses':[target],'addedClasses':['io/vortexcore/rpg/ProfileJoinDispatch.class'],'metadataAndResourcesPreserved':True,'deployed':False}
a.output.with_suffix('.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))
