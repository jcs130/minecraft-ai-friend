"""Build scoped health repairs against the deployed AF.50; never install them."""
import argparse,copy,hashlib,json,os,subprocess,zipfile
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
for key in ('server','jdk','output'):p.add_argument('--'+key,type=Path,required=True)
a=p.parse_args();paper=Path(__file__).resolve().parents[1];source=paper/'plugins/AgentFriend'
base=a.server/'plugins/AgentFriend-0.4.47.50-rpg.jar';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(base)=='bab691c2c53bf9519ae10fd7b2b579986f01154d87e2e58203da4232096b612b'
out=a.output.resolve();assert not out.exists() and not out.is_relative_to(a.server.resolve());out.mkdir(parents=True)
classes=out/'classes';classes.mkdir();empty=out/'empty';empty.mkdir()
cp=os.pathsep.join(map(str,[base,*a.server.glob('libraries/**/*.jar'),*a.server.glob('plugins/*.jar')]))
names=['SiteDungeonManager','AtomicConfigFile','AgentCliRecovery','AgentCliCatalog']
tests=['AtomicConfigFileTest','AgentCliRecoveryTest','DungeonLifecycleTest','DungeonExitAdviceTest','DungeonAdviceTest','AgentCliContractTest','AgentCliTextTest','NativeCliCatalogTest']
def compile_files(files,destination,label):
 options=['--release','21','-proc:none','-implicit:none','-encoding','UTF-8','-sourcepath',str(empty),'-cp',cp,'-d',str(destination),*map(str,files)]
 args=out/(label+'.args');args.write_text('\n'.join('"'+s.replace('\\','/')+'"' for s in options),encoding='utf-8')
 with (out/(label+'.log')).open('wb')as log:result=subprocess.run([str(a.jdk/'bin/javac.exe'),'@'+str(args)],stdout=log,stderr=subprocess.STDOUT)
 if result.returncode:raise SystemExit('Compilation failed: '+label)
baseline=out/'baseline-tests';baseline.mkdir()
compile_files([source/'tests/org/afuhome/agentfriend/AgentCliRecoveryTest.java'],baseline,'baseline-recovery-compile')
with (out/'baseline-recovery.log').open('wb')as log:
 old=subprocess.run([str(a.jdk/'bin/java.exe'),'-ea','-cp',str(baseline)+os.pathsep+cp,'org.afuhome.agentfriend.AgentCliRecoveryTest'],stdout=log,stderr=subprocess.STDOUT,timeout=120)
assert old.returncode!=0,'New resume regression unexpectedly passed on baseline'
compile_files([*[source/f'src/org/afuhome/agentfriend/{n}.java' for n in names],*[source/f'tests/org/afuhome/agentfriend/{n}.java' for n in tests]],classes,'candidate-compile')
lock_exe=None
if os.name=='nt':
 lock_exe=out/'hold-config-file.exe'
 csc=Path(os.environ['WINDIR'])/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
 with(out/'lock-fixture-compile.log').open('wb')as log:result=subprocess.run([str(csc),'/nologo','/out:'+str(lock_exe),str(source/'tests/fixtures/hold-config-file.cs')],stdout=log,stderr=subprocess.STDOUT)
 assert result.returncode==0,'Windows reader fixture failed to compile'
for test in tests:
 command=[str(a.jdk/'bin/java.exe'),'-ea','-cp',str(classes)+os.pathsep+cp,'org.afuhome.agentfriend.'+test]
 if test=='AtomicConfigFileTest' and lock_exe:command.append(str(lock_exe))
 else:command.append(str(source/'resources'))
 with(out/(test+'.log')).open('wb')as log:result=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,timeout=120)
 if result.returncode:raise SystemExit('Regression failed: '+test)
def owned(name):return name.startswith('org/afuhome/agentfriend/') and name.endswith('.class') and name.rsplit('/',1)[-1].split('$')[0].removesuffix('.class') in names
updates={f.relative_to(classes).as_posix():f.read_bytes() for f in classes.rglob('*.class') if owned(f.relative_to(classes).as_posix())}
target=out/'AgentFriend-0.4.47.51-rpg.jar'
with zipfile.ZipFile(base)as before:
 descriptor=before.read('plugin.yml');assert descriptor.count(b'0.4.47.50-rpg')==1
 updates['plugin.yml']=descriptor.replace(b'0.4.47.50-rpg',b'0.4.47.51-rpg')
 assert {n for n in before.namelist() if owned(n)}<=set(updates)
 with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED)as after:
  for entry in before.infolist():after.writestr(copy.copy(entry),updates.get(entry.filename,before.read(entry.filename)))
  for name in sorted(set(updates)-set(before.namelist())):after.writestr(name,updates[name])
with zipfile.ZipFile(base)as before,zipfile.ZipFile(target)as after:
 changed=[n for n in before.namelist()if before.read(n)!=after.read(n)];added=sorted(set(after.namelist())-set(before.namelist()))
 assert set(changed+added)<=set(updates) and not set(before.namelist())-set(after.namelist())
 receipt={'baselineSha256':sha(base),'sha256':sha(target),'classes':names,'changedEntries':changed,'addedEntries':added,'otherEntriesPreserved':len(before.namelist())-len(changed),'tests':tests,'baselineResumeRegressionFailed':True,'nativeWindowsFileLockTest':bool(lock_exe),'productionChanged':False}
(out/'build.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
