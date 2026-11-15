"""Build a pinned FAWE item-adapter candidate. Never installs or touches worlds."""
from pathlib import Path
import argparse, hashlib, json, os, re, subprocess, zipfile

root=Path(__file__).resolve().parent
p=argparse.ArgumentParser(description=__doc__)
for key in ('baseline','libraries','jdk','output'): p.add_argument('--'+key,type=Path,required=True)
a=p.parse_args()
digest=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
assert digest(a.baseline)=='a1706c41412a108e3d2fdbd9e9dd0c60904f2ba45414c6edf11c1262812e1838','Unreviewed FAWE artifact'
assert not a.output.exists(),'Use a fresh output directory'
a.output.mkdir(parents=True)
classes=a.output/'classes';classes.mkdir()
cp=os.pathsep.join(str(x) for x in [a.baseline,*sorted(a.libraries.rglob('*.jar'))])
sources=[root/'HybridItemPatch.java',root/'src/org/afuhome/compat/HybridItemTypes.java']
args=['-proc:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',str(classes),*map(str,sources)]
argfile=a.output/'compile.args';argfile.write_text('\n'.join('"'+s.replace('\\','/')+'"' for s in args),encoding='utf8')
subprocess.run([str(a.jdk/'bin/javac.exe'),'-J-Duser.language=en','@'+str(argfile)],check=True)
entry='com/fastasyncworldedit/bukkit/adapter/CachedBukkitAdapter.class'
with zipfile.ZipFile(a.baseline) as z:(a.output/'before.class').write_bytes(z.read(entry))
runargs=['-cp',str(classes)+os.pathsep+cp,'HybridItemPatch',str(a.output/'before.class'),str(a.output/'after.class')]
runfile=a.output/'patch.args';runfile.write_text('\n'.join('"'+s.replace('\\','/')+'"' for s in runargs),encoding='utf8')
subprocess.run([str(a.jdk/'bin/java.exe'),'@'+str(runfile)],check=True)
helper='org/afuhome/compat/HybridItemTypes.class'
target=a.output/'FastAsyncWorldEdit-2.16.1-qd-hybrid1.jar'
with zipfile.ZipFile(a.baseline) as before,zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED) as after:
    assert helper not in before.namelist()
    for info in before.infolist():
        data=before.read(info)
        if info.filename==entry:data=(a.output/'after.class').read_bytes()
        if info.filename in ('plugin.yml','paper-plugin.yml'):
            data,n=re.subn(rb'(?m)^version:[^\r\n]*',b'version: 2.16.1-qd-hybrid1',data)
            assert n==1
        after.writestr(info,data)
    item=zipfile.ZipInfo(helper,(2026,11,14,0,0,0));item.compress_type=zipfile.ZIP_DEFLATED
    after.writestr(item,(classes/helper).read_bytes())
with zipfile.ZipFile(a.baseline) as before,zipfile.ZipFile(target) as after:
    changes=[n for n in before.namelist() if before.read(n)!=after.read(n)]
    assert entry in changes and set(changes)<= {entry,'plugin.yml','paper-plugin.yml'}
    assert set(after.namelist())-set(before.namelist())=={helper}
    assert len(after.namelist())==len(set(after.namelist()))
report={'baselineSha256':digest(a.baseline),'candidateSha256':digest(target),'changed':changes,'added':[helper],'productionWrites':False}
(a.output/'build.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps(report))
