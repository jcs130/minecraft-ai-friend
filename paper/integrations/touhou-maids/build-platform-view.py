"""Compile the native vanilla-view overlay against an explicit installed Youer tree; never installs."""
from pathlib import Path
import argparse,copy,hashlib,json,os,re,subprocess,zipfile

parser=argparse.ArgumentParser(description=__doc__)
for key in ['server','jdk','output']:parser.add_argument('--'+key,type=Path,required=True)
args=parser.parse_args();root=Path(__file__).resolve().parent
base=args.server/'mods/qiandengji-native-platform-0.1.4.jar'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(base)=='d8da69fb6bec29efe0d12d0728d1bab98fb876ba2eda8efe2110316333f517e2','Review a changed native baseline explicitly'
out=args.output.resolve();out.mkdir(parents=True,exist_ok=False);classes=out/'classes';classes.mkdir()
dependencies=[base,*args.server.glob('mods/*.jar'),*args.server.glob('libraries/**/*.jar'),*args.server.glob('plugins/*.jar')]
cp=os.pathsep.join(map(str,dependencies));sources=sorted(root.glob('platform-src/**/*.java'))
arguments=['-proc:none','-implicit:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',classes,*sources]
argfile=out/'compile.args';argfile.write_text('\n'.join('"'+str(v).replace('\\','/')+'"'for v in arguments),encoding='utf-8')
with(out/'compile.log').open('wb')as log:result=subprocess.run([args.jdk/'bin/javac.exe','@'+str(argfile)],stdout=log,stderr=subprocess.STDOUT)
assert result.returncode==0,'Inspect compile.log; no artifact installed'
changes={file.relative_to(classes).as_posix():file.read_bytes()for file in classes.rglob('*.class')}
assert changes and all(name.startswith('local/tlmcompat/numen/')for name in changes)
maid=args.server/'mods/touhoulittlemaid-1.5.3-qiandengji.jar'
with zipfile.ZipFile(maid)as mod:changes['qiandengji-tlm-zh.json']=mod.read('assets/touhou_little_maid/lang/zh_cn.json')
with zipfile.ZipFile(base)as before:
 descriptor,count=re.subn(rb'(?m)^version="0\.1\.4"$',b'version="0.1.6"',before.read('META-INF/neoforge.mods.toml'));assert count==1
 changes['META-INF/neoforge.mods.toml']=descriptor
 mixins=json.loads(before.read('qiandengji-native.mixins.json'))
 assert 'MaidTextProjection'not in mixins['mixins']
 mixins['mixins'].append('MaidTextProjection')
 changes['qiandengji-native.mixins.json']=(json.dumps(mixins,separators=(',',':'))+'\n').encode()
 jar=out/'qiandengji-native-platform-0.1.6.jar'
 with zipfile.ZipFile(jar,'x',zipfile.ZIP_DEFLATED)as after:
  for info in before.infolist():after.writestr(copy.copy(info),changes.get(info.filename,before.read(info.filename)))
  for name,data in changes.items():
   if name not in before.namelist():after.writestr(name,data)
with zipfile.ZipFile(base)as before,zipfile.ZipFile(jar)as after:
 changed={name for name in after.namelist()if name not in before.namelist()or before.read(name)!=after.read(name)}
 assert changed==set(changes)
 record={'artifact':jar.name,'sha256':sha(jar),'baselineSha256':sha(base),'changedEntries':sorted(changed),'otherEntriesPreserved':len(set(before.namelist())-changed),
         'sourceSha256':{str(p.relative_to(root)):sha(p)for p in sources},'productionChanged':False}
(out/'build.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8');print(json.dumps(record))
