"""Build a pinned narrow candidate. Never installs a plugin or changes game state."""
from pathlib import Path
import argparse,hashlib,json,subprocess,tempfile,zipfile,copy,re
p=argparse.ArgumentParser(description=__doc__)
for name in ['baseline','classpath-file','javac','output']:p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();assert not a.output.exists() and a.baseline.resolve()!=a.output.resolve()
sha=lambda b:hashlib.sha256(b).hexdigest()
assert sha(a.baseline.read_bytes())=='3a328893ab7b9319b62836122ff3e071abce0c05b6b06fc18ea97ce7a0a83d61','Review a changed bridge baseline first'
root=Path(__file__).parent;prefix='local/tlmcompat/hybrid/'
names=['HybridMaidPlugin','NativeMaidSpeech','MaidSpeechLines','MaidAmbientPolicy','MaidVoiceClips','MaidCompanionPolicy','NativeMaidCompanionSupport']
owned=lambda n:any(n==prefix+c+'.class'or n.startswith(prefix+c+'$')for c in names)
a.output.parent.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='maid-voice-patrol-',dir=a.output.parent)as temp:
 temp=Path(temp);classes=temp/'classes'
 args=['--release','21','-encoding','UTF-8','-proc:none','-implicit:none','-cp',str(a.baseline)+';'+a.classpath_file.read_text(encoding='utf-8-sig').strip(),'-d',str(classes),*[str(root/'hybrid-src'/prefix/(n+'.java'))for n in names]]
 argfile=temp/'args';argfile.write_text('\n'.join('"'+x.replace('\\','/')+'"'for x in args),encoding='utf8')
 subprocess.run([str(a.javac),'-J-Duser.language=en','@'+str(argfile)],check=True)
 changes={f.relative_to(classes).as_posix():f.read_bytes()for f in classes.rglob('*.class')}
 assert all(owned(n)for n in changes)
 with zipfile.ZipFile(a.baseline)as before,zipfile.ZipFile(a.output,'x',zipfile.ZIP_DEFLATED)as after:
  changes['plugin.yml']=re.sub(rb'(?m)^version:.*$',b'version: 0.1.17-bubbles-voice-patrol',before.read('plugin.yml'))
  for info in before.infolist():
   if owned(info.filename)and info.filename not in changes:continue
   after.writestr(copy.copy(info),changes.get(info.filename,before.read(info.filename)))
  for n,b in changes.items():
   if n not in before.namelist():
    info=zipfile.ZipInfo(n,(2026,11,9,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;after.writestr(info,b)
 with zipfile.ZipFile(a.baseline)as before,zipfile.ZipFile(a.output)as after:
  untouched=[n for n in before.namelist()if not owned(n)and n!='plugin.yml']
  assert all(before.read(n)==after.read(n)for n in untouched)
  assert set(before.namelist())-set(after.namelist())<=set(n for n in before.namelist()if owned(n))
 proof={'version':'0.1.17-bubbles-voice-patrol','artifact':str(a.output),'sha256':sha(a.output.read_bytes()),'baselineSha256':sha(a.baseline.read_bytes()),'unrelatedEntriesPreserved':len(untouched),'changedEntries':sorted(changes),'sourceSha256':{n:sha((root/'hybrid-src'/prefix/(n+'.java')).read_bytes().replace(b'\r\n',b'\n'))for n in names},'productionChanged':False}
 a.output.with_suffix('.build.json').write_text(json.dumps(proof,indent=2))
 print(json.dumps(proof))
