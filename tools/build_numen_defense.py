from pathlib import Path
import hashlib, importlib.util, json, os, subprocess, zipfile, shutil, argparse, uuid
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description="Build and test the native ranged defense overlay; never deploys.")
parser.add_argument("--output",type=Path,default=ROOT/"runtime/numen-defense-build"/uuid.uuid4().hex)
parser.add_argument("--baseline-jar",type=Path,default=ROOT/'server/mc/mods/numen-neoforge-1.21.1-0.1.3.jar')
parser.add_argument("--jdk-bin",type=Path,default=Path(os.environ.get('JDK21_BIN',r'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin')))
args=parser.parse_args()
HERE=args.output.resolve()
if not HERE.is_relative_to((ROOT/'runtime').resolve()):raise SystemExit('Build output must be under runtime')
HERE.mkdir(parents=True,exist_ok=False)
JDK=args.jdk_bin.resolve()
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
walk=load('walk',ROOT/'tools/build_numen_walk_only.py');helper=load('cp',ROOT/'world/botgate-src/build.py')
baseline=args.baseline_jar.resolve()
if walk.sha(baseline.read_bytes())!='5e913b2ffb1a39b199333f768526537867be726bf27c451e7a1a507cc8a35da0':raise SystemExit('Exact deployed 5e913b baseline required')
jar=HERE/'baseline-numen.jar'
shutil.copy2(baseline,jar)
deps=walk.embedded_dependencies(jar,HERE/'dependencies')
cp=os.pathsep.join([str(jar),*map(str,deps),helper.full_cp(ROOT/'server/mc/libraries')])
names=['combat/Menace','combat/Haven','task/chain/MobDefenseChain','task/combat/AttackCompanionTask']
sources=[ROOT/'world/numen-src/core/common/src/main/java/com/dwinovo/numen/core'/f'{n}.java' for n in names]
classes=HERE/'patched-classes';classes.mkdir(exist_ok=True)
quote=lambda s:'"'+str(s).replace('\\','/')+'"'
args=HERE/'javac.args';args.write_text('\n'.join(['-proc:none','--release','21','-encoding','UTF-8','-cp',quote(cp),'-d',quote(classes),*map(quote,sources)]),encoding='utf8')
subprocess.run([str(JDK/'javac.exe'),'@'+str(args)],check=True)
target=HERE/'numen-neoforge-1.21.1-0.1.3-ranged-defense-v1.jar'
families={'com/dwinovo/numen/core/'+n for n in names}
preserved=walk.overlay_jar(jar,classes,target,families)
record={'schema':1,'ok':True,'capability':'ranged_defense_v1','baselineJar':str(jar),'baselineJarSha256':walk.sha(jar.read_bytes()),'jar':str(target),'sha256':walk.sha(target.read_bytes()),'classFamilies':sorted(families),'sourceFiles':[{'path':str(p.relative_to(ROOT)).replace('\\','/'),'sha256':walk.sha(p.read_bytes())} for p in sources], 'deployment':'not performed',**preserved}
with zipfile.ZipFile(jar) as old,zipfile.ZipFile(target) as new:
 record['changedJarEntries']=[n for n in old.namelist() if n in new.namelist() and old.read(n)!=new.read(n)]
 record['addedJarEntries']=[n for n in new.namelist() if n not in old.namelist()]
record['builderFiles']=[{'path':str(p.relative_to(ROOT)).replace('\\','/'),'sha256':walk.sha(p.read_bytes())} for p in [Path(__file__),ROOT/'tools/build_numen_walk_only.py',ROOT/'world/botgate-src/build.py',ROOT/'tools/test_numen_defense.py',ROOT/'tools/test_numen_defense_navigation.py']]
seam=load('defense_test',ROOT/'tools/test_numen_defense.py')
qa=seam.run(target,HERE/'seam')
if not qa['ok']:raise SystemExit('Native defense seam failed')
report=HERE/'seam/report.json'
record['tests']=[{'path':str(report),'sha256':walk.sha(report.read_bytes()),'exitCode':qa['exitCode'],'passed':qa['assertions']-qa['failed']}]
subprocess.run([os.sys.executable,str(ROOT/'tools/test_numen_defense_navigation.py'),'--jar',str(target),'--output',str(HERE/'navigation-seam')],check=True)
report=HERE/'navigation-seam/report.json'
nav=json.loads(report.read_text(encoding='utf8'))
record['tests'].append({'path':str(report),'sha256':walk.sha(report.read_bytes()),'exitCode':nav['exitCode'],'passed':nav['passed']})
record['physicalVerified']=False
record['sourceCommit']=subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip()
(HERE/'build-record.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf8')
print(json.dumps({k:record[k] for k in ['ok','jar','sha256','compiledClasses','preservedEntries','changedJarEntries','addedJarEntries']}))
