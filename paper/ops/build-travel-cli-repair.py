"""Build the scoped travel repair on the reviewed, deployed AF.49; never install it."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile

parser=argparse.ArgumentParser(description=__doc__)
for key in ('server','jdk','output'): parser.add_argument('--'+key,type=Path,required=True)
args=parser.parse_args()
paper=Path(__file__).resolve().parents[1]
baseline=args.server/'plugins/AgentFriend-0.4.47.49-rpg.jar'
sha=lambda file:hashlib.sha256(file.read_bytes()).hexdigest()
assert sha(baseline)=='3eb0b4e2bb24706af8b5222e63e3a809eeededbbada8b26d0b912388ab989a24'
out=args.output.resolve()
assert not out.exists() and not out.is_relative_to(args.server.resolve())
out.mkdir(parents=True)
classes=out/'classes';classes.mkdir()
empty=out/'empty';empty.mkdir()
names=['DungeonExpeditions','WaypointManager','SiteDungeonManager','ActionFeedback']
source=paper/'plugins/AgentFriend'
sources=[source/f'src/org/afuhome/agentfriend/{name}.java' for name in names]
tests=['AgentCliRecoveryTest','AgentCliContractTest','AgentCliTextTest','NativeCliCatalogTest','ProtectionGuidanceTest']
sources += [source/f'tests/org/afuhome/agentfriend/{name}.java' for name in tests]
cp=os.pathsep.join(map(str,[baseline,*args.server.glob('libraries/**/*.jar'),*args.server.glob('plugins/*.jar')]))
options=['--release','21','-proc:none','-implicit:none','-encoding','UTF-8','-sourcepath',str(empty),'-cp',cp,'-d',str(classes),*map(str,sources)]
argfile=out/'compile.args';argfile.write_text('\n'.join('"'+s.replace('\\','/')+'"' for s in options),encoding='utf-8')
with (out/'compile.log').open('wb') as log:
    result=subprocess.run([str(args.jdk/'bin/javac.exe'),'@'+str(argfile)],stdout=log,stderr=subprocess.STDOUT)
if result.returncode: raise SystemExit('Compilation failed; inspect isolated compile.log')
for name in tests:
    with (out/(name+'.log')).open('wb') as log:
        result=subprocess.run([str(args.jdk/'bin/java.exe'),'-ea','-cp',str(classes)+os.pathsep+cp,
            'org.afuhome.agentfriend.'+name,str(source/'resources')],stdout=log,stderr=subprocess.STDOUT,timeout=120)
    if result.returncode: raise SystemExit('Regression failed: '+name)
def owned(name): return name.startswith('org/afuhome/agentfriend/') and name.endswith('.class') and name.rsplit('/',1)[-1].split('$')[0].removesuffix('.class') in names
updates={p.relative_to(classes).as_posix():p.read_bytes() for p in classes.rglob('*.class') if owned(p.relative_to(classes).as_posix())}
target=out/'AgentFriend-0.4.47.50-rpg.jar'
with zipfile.ZipFile(baseline) as before:
    descriptor=before.read('plugin.yml');assert descriptor.count(b'0.4.47.49-rpg')==1
    updates['plugin.yml']=descriptor.replace(b'0.4.47.49-rpg',b'0.4.47.50-rpg')
    assert {n for n in before.namelist() if owned(n)}<=set(updates)
    with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED) as after:
        for entry in before.infolist(): after.writestr(copy.copy(entry),updates.get(entry.filename,before.read(entry.filename)))
        for name in sorted(set(updates)-set(before.namelist())): after.writestr(name,updates[name])
with zipfile.ZipFile(baseline) as before,zipfile.ZipFile(target) as after:
    changed=[name for name in before.namelist() if before.read(name)!=after.read(name)]
    added=sorted(set(after.namelist())-set(before.namelist()))
    assert set(changed+added)<=set(updates) and not set(before.namelist())-set(after.namelist())
receipt={'baselineSha256':sha(baseline),'sha256':sha(target),'classes':names,'changedEntries':changed,'addedEntries':added,
    'otherEntriesPreserved':len(before.namelist())-len(changed),'tests':tests,'productionChanged':False}
(out/'build.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'sha256':sha(target),'tests':tests,'productionChanged':False}))
