"""Reproducible patch builds for the reviewed 2026-11-17 native baseline."""
from pathlib import Path
import os,subprocess,tempfile,zipfile,hashlib,json,re,shutil
# Builds candidates only; refuses any output inside the supplied live runtime.
import argparse
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--server',type=Path,required=True)
parser.add_argument('--jdk',type=Path,required=True)
parser.add_argument('--out',type=Path,required=True)
args=parser.parse_args()
ROOT=Path(__file__).resolve().parents[3]
SERVER=args.server.resolve();OUT=args.out.resolve();JAVA=args.jdk.resolve()/'bin'
assert not OUT.is_relative_to(SERVER),'candidate output must be outside the server'
OUT.mkdir(parents=True,exist_ok=True)
def compile(sources,cp,work):
 classes=work/'classes';classes.mkdir(parents=True,exist_ok=True)
 args=['--release','21','-encoding','UTF-8','-proc:none','-implicit:none','-cp',os.pathsep.join(map(str,cp)),'-d',str(classes),*map(str,sources)]
 af=work/'javac.args';af.write_text('\n'.join('"'+s.replace('\\','/')+'"'for s in args),encoding='utf8')
 subprocess.run([str(JAVA/'javac.exe'),'@'+str(af)],check=True)
 return classes
def jar(target,entries):
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED)as z:
  for name,value in sorted(entries.items()):
   info=zipfile.ZipInfo(name,(2026,11,18,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,value)
 return {'file':str(target),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
cp=list(SERVER.glob('libraries/**/*.jar'))+list(SERVER.glob('mods/*.jar'))+list(SERVER.glob('plugins/*.jar'))
report={}
with tempfile.TemporaryDirectory(dir=OUT,prefix='compile-')as directory:
 work=Path(directory)
 brain=SERVER/'mods/qiandengji-maid-brain-0.1.0.jar'
 assert hashlib.sha256(brain.read_bytes()).hexdigest()=='d401a7bb80cc910f94e55ebdfc774db090ac8f1a5747dbf885a68772898c4b65'
 source=ROOT/'paper/integrations/touhou-maids/brain-extension/src/local/qdj/maids/brain/MaidSpeechControl.java'
 classes=compile([source],cp,work/'brain')
 with zipfile.ZipFile(brain)as z:entries={n:z.read(n)for n in z.namelist()if not n.endswith('/')}
 entries.update({p.relative_to(classes).as_posix():p.read_bytes()for p in classes.rglob('*.class')})
 metadata=entries['META-INF/neoforge.mods.toml'].decode()
 metadata,count=re.subn(r'(modId\s*=\s*"qiandengji_maid_brain"\s*\nversion\s*=\s*")0\.1\.1(")',r'\g<1>0.1.2\2',metadata)
 assert count==1,'exact brain metadata version preimage'
 entries['META-INF/neoforge.mods.toml']=metadata.encode()
 report['brain']=jar(OUT/'qiandengji-maid-brain-npc-voice.jar',entries)
 base=SERVER/'plugins/qiandengji-maid-native-0.1.12-conversation.jar'
 assert hashlib.sha256(base.read_bytes()).hexdigest()=='abb2350c3d813bcf4535b3145892ae15a78af2b081ef336d4c85446300c99f23'
 sources=ROOT/'paper/integrations/touhou-maids/hybrid-src/local/tlmcompat/hybrid'
 names=['HybridMaidPlugin','NativeMaidSpeech','NativeMaidVoices','NativeMaidBodyActions']
 classes=compile([sources/(n+'.java')for n in names],[base,*cp],work/'maid')
 with zipfile.ZipFile(base)as z:entries={n:z.read(n)for n in z.namelist()if not n.endswith('/')}
 for n in list(entries):
  if n.startswith('local/tlmcompat/hybrid/')and n.rsplit('/',1)[1].split('$')[0].removesuffix('.class')in names:del entries[n]
 entries.update({p.relative_to(classes).as_posix():p.read_bytes()for p in classes.rglob('*.class')})
 entries['plugin.yml']=re.sub(rb'(?m)^version:.*$',b'version: 0.1.47-npc-voice',entries['plugin.yml'])
 report['maid']=jar(OUT/'QiandengjiMaidBridge-0.1.47-npc-voice.jar',entries)
 native=ROOT/'paper/integrations/numen-hosting/native-bridge'
 patched=[p for p in cp if p.name.startswith('neoforge-')and p.name.endswith('-server.jar')]
 classes=compile(sorted((native/'src').rglob('*.java')),[*patched,*cp],work/'hosted')
 entries={p.relative_to(classes).as_posix():p.read_bytes()for p in classes.rglob('*.class')}
 entries['META-INF/neoforge.mods.toml']=(native/'neoforge.mods.toml').read_bytes();entries['qiandengji-hosted.mixins.json']=(native/'qiandengji-hosted.mixins.json').read_bytes()
 report['hosted']=jar(OUT/'qiandengji-hosted-bridge-0.1.2.jar',entries)
 (OUT/'build.json').write_text(json.dumps(report,indent=2),encoding='utf8')
 print(json.dumps(report))
