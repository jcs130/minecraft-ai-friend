"""Carry forward the existing narrow Youer compatibility fix; no installation."""
from pathlib import Path
import argparse,hashlib,subprocess,os,json,copy,zipfile
p=argparse.ArgumentParser(description=__doc__)
for name in ['upstream','server','jdk','output']:p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();root=Path(__file__).resolve().parent;out=a.output.resolve();sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
assert sha(a.upstream)=='8b01d2f8c7ef7de1dda6e8acd5d3e12ad377767b4d842580dac443a5f99031b2'
assert not out.exists()and not out.is_relative_to(a.server.resolve());out.mkdir(parents=True);classes=out/'classes';classes.mkdir()
patch=root/'patches/GeyserLambdaLookupPatch.java';test=root/'fixtures/GeyserLambdaLookupTest.java'
cp=os.pathsep.join(map(str,[a.upstream,*a.server.glob('libraries/org/ow2/asm/**/*.jar')]))
def run(args,log):
    with(out/log).open('wb')as f:result=subprocess.run(args,stdout=f,stderr=subprocess.STDOUT,timeout=60)
    if result.returncode:raise SystemExit('Failed; inspect '+log)
run([str(a.jdk/'bin/javac.exe'),'-encoding','UTF-8','--release','21','-cp',cp,'-d',str(classes),str(patch),str(test)],'compile.log')
entry='org/lanternpowered/lmbda/InternalLambdaFactory.class'
with zipfile.ZipFile(a.upstream)as before:
    source=before.read(entry);assert hashlib.sha256(source).hexdigest()=='3cf9f39e43f0befbf786df134aac78493d41fe1e9d09d17369054d3ea2e74d34'
    original=out/'original.class';original.write_bytes(source);patched=out/'patched.class'
    run([str(a.jdk/'bin/java.exe'),'-cp',str(classes)+os.pathsep+cp,'GeyserLambdaLookupPatch',str(original),str(patched)],'patch.log')
    target=out/'Geyser-Spigot-2.12.1-b1280-youer.jar'
    with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED)as to:
        for item in before.infolist():to.writestr(copy.copy(item),patched.read_bytes()if item.filename==entry else before.read(item))
with zipfile.ZipFile(a.upstream)as before,zipfile.ZipFile(target)as after:
    changed=[n for n in before.namelist()if before.read(n)!=after.read(n)]
    assert changed==[entry]and before.namelist()==after.namelist()
    preserved=len(before.namelist())-1
run([str(a.jdk/'bin/java.exe'),'-ea','-cp',str(classes)+os.pathsep+str(target),'GeyserLambdaLookupTest'],'lambda-test.log')
record={'artifact':target.name,'sha256':sha(target),'upstreamSha256':sha(a.upstream),'changedEntries':changed,'otherEntriesPreserved':preserved,'patchedClassSha256':sha(patched),'methods':json.loads((out/'patch.log').read_text()),'functionalChecks':4,'productionChanged':False,'sources':{str(f.relative_to(root.parent)):sha(f)for f in [patch,test,Path(__file__)]}}
(out/'build.json').write_text(json.dumps(record,indent=2));print(json.dumps(record))
