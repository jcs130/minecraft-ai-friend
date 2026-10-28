"""Add bounded atomic-heartbeat retry to frozen 0.1.7, preserving its account bridge."""
from pathlib import Path
import argparse,subprocess,sys,hashlib,zipfile,json
root=Path(__file__).resolve().parent;p=argparse.ArgumentParser(description=__doc__)
for key in ['base','original','proxy','jdk','libre','output']:p.add_argument('--'+key,type=Path,required=True)
a=p.parse_args();assert not a.output.exists();assert hashlib.sha256(a.base.read_bytes()).hexdigest()=='15a9fe181d45db4965512fb0c4f5138710479f6f26cfbde806f2f547ce990757'
a.output.mkdir(parents=True);baseline=a.output/'baseline'
subprocess.run([sys.executable,str(root/'build-mcbot.py'),'--base',str(a.original),'--proxy',str(a.proxy),'--jdk',str(a.jdk),'--libre',str(a.libre),'--output',str(baseline)],check=True)
with zipfile.ZipFile(a.base)as actual,zipfile.ZipFile(baseline/'LoginGuard-0.1.7.jar')as rebuilt:
 assert actual.namelist()==rebuilt.namelist()and all(actual.read(n)==rebuilt.read(n)for n in actual.namelist()),'Pinned source rebuild differs'
source=(baseline/'LoginGuard.java').read_text();old='''            Files.writeString(tmp,gson.toJson(Map.of("ready",ready,"at",System.currentTimeMillis(),"authorizedNames",names,"sessionStates",observations)));
            Files.move(tmp,heartbeat,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);''';assert source.count(old)==1
source=source.replace('    void publishHeartbeat() {','    synchronized void publishHeartbeat() {').replace(old,'            AtomicHeartbeatSnapshot.write(heartbeat,gson.toJson(Map.of("ready",ready,"at",System.currentTimeMillis(),"authorizedNames",names,"sessionStates",observations)));')
generated=a.output/'LoginGuard.java';generated.write_text(source,encoding='utf8');classes=a.output/'classes';classes.mkdir();cp=(baseline/'classpath.txt').read_text()
subprocess.run([str(a.jdk/'bin/javac.exe'),'-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',str(classes),str(generated),str(root/'src/org/afuhome/auth/AtomicHeartbeatSnapshot.java')],check=True)
compiled={f.relative_to(classes).as_posix():f.read_bytes()for f in classes.rglob('*.class')};jar=a.output/'LoginGuard-0.1.8.jar';retained=0
with zipfile.ZipFile(a.base)as oldjar,zipfile.ZipFile(jar,'w',zipfile.ZIP_DEFLATED)as z:
 for entry in oldjar.infolist():
  if entry.filename in compiled:continue
  blob=oldjar.read(entry)
  if entry.filename=='velocity-plugin.json':meta=json.loads(blob);meta['version']='0.1.8';blob=json.dumps(meta).encode()
  else:retained+=1
  z.writestr(entry,blob)
 for name,blob in compiled.items():z.writestr(name,blob)
(a.output/'classpath.txt').write_text(str(classes)+';'+cp)
(a.output/'build.json').write_text(json.dumps({'baseSha256':hashlib.sha256(a.base.read_bytes()).hexdigest(),'sha256':hashlib.sha256(jar.read_bytes()).hexdigest(),'changedClasses':sorted(compiled),'retainedEntries':retained,'accountBridgeRetained':True,'productionChanged':False},indent=2),encoding='utf8')
print('Built 0.1.8 atomic heartbeat fix only')
