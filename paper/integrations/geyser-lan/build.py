"""Pinned Geyser b1295: preserve Youer lookup compatibility and add optional LAN transport. Never installs."""
from pathlib import Path
import argparse,copy,hashlib,json,os,subprocess,zipfile

ROOT=Path(__file__).resolve().parent
PINS={
 'org/geysermc/geyser/network/bedrock/nethernet/NetherNetServer.class':'6322acfdfa1c33911bd999fdf7f3efd2799824a21bd75c57533d9e109d0ed732',
 'org/geysermc/geyser/util/LoginEncryptionUtils.class':'2e0b5f64d759f9cd1e6e8beb6402d6a52ffac61d40d3e5563fa2bbcb7a17cf27',
 'org/lanternpowered/lmbda/InternalLambdaFactory.class':'3cf9f39e43f0befbf786df134aac78493d41fe1e9d09d17369054d3ea2e74d34',
}
UPSTREAM='b60ff8f9a007f30823cf40173532a0390e6150cdfc577551f6f37bdd5ccd1528'
def sha(b):return hashlib.sha256(b).hexdigest()
def main():
 p=argparse.ArgumentParser(description=__doc__)
 for n in ['upstream','server','jdk','output']:p.add_argument('--'+n,type=Path,required=True)
 a=p.parse_args();assert sha(a.upstream.read_bytes())==UPSTREAM,'Unreviewed upstream'
 out=a.output.resolve();assert not out.exists() and not out.is_relative_to(a.server.resolve());out.mkdir(parents=True)
 classes=out/'classes';classes.mkdir()
 deps=[a.upstream,*sorted((a.server/'libraries').rglob('*.jar'))]
 cp=os.pathsep.join(map(str,deps));(out/'classpath.txt').write_text(cp,encoding='utf8')
 ops=ROOT.parent.parent/'ops'
 sources=[*sorted((ROOT/'src').rglob('*.java')),*sorted((ROOT/'tests').rglob('*.java')),ROOT/'patch/GeyserLanPatch.java',ops/'patches/GeyserLambdaLookupPatch.java',ops/'fixtures/GeyserLambdaLookupTest.java']
 def run(args,name):
  result=subprocess.run(args,capture_output=True,timeout=90);(out/name).write_bytes(result.stdout+result.stderr)
  if result.returncode:raise RuntimeError('Failed; inspect '+str(out/name))
 argfile=out/'compile.args';argfile.write_text('\n'.join('"'+str(x).replace('\\','/')+'"' for x in ['-proc:none','-encoding','UTF-8','--release','21','-cp',cp,'-d',classes,*sources]),encoding='utf8')
 run([str(a.jdk/'bin/javac.exe'),'@'+str(argfile)],'compile.log')
 run([str(a.jdk/'bin/java.exe'),'-ea','-cp',str(classes),'org.qiandengji.geyserlan.LanAdmissionLedgerTest'],'admission-test.log')
 run([str(a.jdk/'bin/java.exe'),'-ea','-cp',str(classes),'org.qiandengji.geyserlan.LanAnswerPolicyTest'],'answer-test.log')
 changed={};methods={}
 with zipfile.ZipFile(a.upstream)as z:
  for entry,pin in PINS.items():
   original=z.read(entry);assert sha(original)==pin
   before=out/(Path(entry).stem+'.before');after=out/(Path(entry).stem+'.after');before.write_bytes(original)
   tool='GeyserLambdaLookupPatch' if 'InternalLambdaFactory' in entry else 'GeyserLanPatch'
   log=Path(entry).stem+'.patch.json';run([str(a.jdk/'bin/java.exe'),'-cp',str(classes)+os.pathsep+cp,tool,str(before),str(after)],log)
   changed[entry]=after.read_bytes();methods[entry]=json.loads((out/log).read_text())
  jar=out/'Geyser-Spigot-2.12.1-b1295-youer-lan2.jar'
  with zipfile.ZipFile(jar,'x',zipfile.ZIP_DEFLATED)as target:
   for info in z.infolist():target.writestr(copy.copy(info),changed.get(info.filename,z.read(info)))
   for file in sorted((classes/'org/qiandengji/geyserlan').glob('*.class')):
    if file.stem.endswith('Test'):continue
    info=zipfile.ZipInfo(file.relative_to(classes).as_posix(),(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
    target.writestr(info,file.read_bytes())
 with zipfile.ZipFile(a.upstream)as before,zipfile.ZipFile(jar)as after:
  actual=[n for n in before.namelist() if before.read(n)!=after.read(n)]
  assert set(actual)==set(PINS)
  additions=sorted(set(after.namelist())-set(before.namelist()));assert all(x.startswith('org/qiandengji/geyserlan/') for x in additions)
 run([str(a.jdk/'bin/java.exe'),'-ea','-cp',str(classes)+os.pathsep+str(jar),'GeyserLambdaLookupTest'],'lookup-test.log')
 record={'upstreamBuild':1295,'upstreamCommit':'1955f5151e2af01a7b51db1679e4324345690e70','upstreamSha256':UPSTREAM,'artifact':jar.name,'sha256':sha(jar.read_bytes()),'changedEntries':actual,'addedEntries':additions,'otherEntriesPreserved':len(before.namelist())-len(actual),'methods':methods,'tests':{'admission':(out/'admission-test.log').read_text().strip(),'answer':(out/'answer-test.log').read_text().strip(),'lookup':(out/'lookup-test.log').read_text().strip()},'productionChanged':False}
 (out/'build.json').write_text(json.dumps(record,indent=2),encoding='utf8');print(json.dumps(record))
if __name__=='__main__':main()
