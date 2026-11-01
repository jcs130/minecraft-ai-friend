"""Build only the reviewed Bukkit payload correction over the installed maid bridge."""
from pathlib import Path
import argparse,copy,hashlib,json,os,re,subprocess,zipfile

parser=argparse.ArgumentParser(description=__doc__)
for key in ['server','jdk','output']:parser.add_argument('--'+key,type=Path,required=True)
args=parser.parse_args();root=Path(__file__).resolve().parent
original=args.server/'plugins/qiandengji-maid-native-0.1.4.jar'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(original)=='f972b477472f62b729f5b7fe143874495f69e472e6e31a7de7e22c3df797c0c4','Review a changed maid baseline before applying this overlay'
out=args.output.resolve();out.mkdir(parents=True,exist_ok=False);classes=out/'classes';classes.mkdir()
dependencies=[original,*args.server.glob('libraries/**/*.jar'),*args.server.glob('plugins/*.jar'),*args.server.glob('mods/*.jar')]
sources=sorted((root/'hybrid-src').rglob('*.java'))
assert len(sources)==1 and sources[0].name=='HybridPluginPayloads.java'
values=['--release','21','-proc:none','-implicit:none','-encoding','UTF-8','-Xmaxerrs','20','-classpath',os.pathsep.join(map(str,dependencies)),'-d',str(classes),*map(str,sources)]
argfile=out/'compile.args';argfile.write_text('\n'.join('"'+value.replace('\\','/')+'"'for value in values),encoding='utf8')
with(out/'compile.log').open('wb')as log:result=subprocess.run([str(args.jdk/'bin/javac.exe'),'-J-Duser.language=en','@'+str(argfile)],stdout=log,stderr=subprocess.STDOUT)
assert result.returncode==0,'Inspect compile.log; production files were not changed'
updates={p.relative_to(classes).as_posix():p.read_bytes()for p in classes.rglob('*.class')}
assert set(updates)=={'local/tlmcompat/hybrid/HybridPluginPayloads.class','local/tlmcompat/hybrid/HybridPluginPayloads$1.class'}
target=out/'qiandengji-maid-native-0.1.6.jar'
with zipfile.ZipFile(original)as before:
 descriptor,count=re.subn(rb"(?m)^version: '0\.1\.5'",b"version: '0.1.6'",before.read('plugin.yml'));assert count==1
 updates['plugin.yml']=descriptor
 with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED)as after:
  for entry in before.infolist():after.writestr(copy.copy(entry),updates.get(entry.filename,before.read(entry.filename)))
with zipfile.ZipFile(original)as before,zipfile.ZipFile(target)as after:
 assert set(before.namelist())==set(after.namelist())
 changed={name for name in after.namelist()if before.read(name)!=after.read(name)};assert changed==set(updates)
receipt={'artifact':target.name,'version':'0.1.6','sha256':sha(target),'baselineSha256':sha(original),'changedEntries':sorted(changed),'otherEntriesPreserved':len(after.namelist())-len(changed),'sourceSha256':{str(p.relative_to(root)):sha(p)for p in sources},'productionChanged':False}
(out/'build.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf8');print(json.dumps(receipt))
