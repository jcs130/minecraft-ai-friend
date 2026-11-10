"""Narrow the independently compiled upload fix; never installs a plugin."""
from pathlib import Path
import argparse,hashlib,copy,re,zipfile,json
p=argparse.ArgumentParser(description=__doc__)
for name in ['baseline','compiled-classes','output']:p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();assert not a.output.exists();sha=lambda b:hashlib.sha256(b).hexdigest()
assert not (a.compiled_classes/'dev/god/godvoice/VoiceUploadTrace.class').exists(),'Historical 0.1.4 -> 0.1.5 packer: newer diagnostics require a newly reviewed runtime baseline and complete class list; do not omit VoiceUploadTrace'
assert sha(a.baseline.read_bytes())=='314ef8d56c5dee2ed217760293ac764aa61654294d1152989e3f31ce6d2c91ed','Review the changed production baseline first'
prefix='dev/god/godvoice/';names=['PaperVoicePlugin','VoiceUploads','VoiceDiagnostics'];owned=lambda n:any(n==prefix+c+'.class' or n.startswith(prefix+c+'$') for c in names)
changes={f.relative_to(a.compiled_classes).as_posix():f.read_bytes() for f in a.compiled_classes.rglob('*.class') if owned(f.relative_to(a.compiled_classes).as_posix())}
assert all(prefix+n+'.class' in changes for n in names)
a.output.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(a.output,'x',zipfile.ZIP_DEFLATED) as new:
 changes['plugin.yml']=re.sub(rb'(?m)^version:[^\r\n]*',b'version: 0.1.5',old.read('plugin.yml'))
 for info in old.infolist():
  if owned(info.filename) and info.filename not in changes:continue
  new.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
 for name,data in changes.items():
  if name not in old.namelist():
   info=zipfile.ZipInfo(name,(2026,11,10,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;new.writestr(info,data)
with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(a.output) as new:
 untouched=[n for n in old.namelist() if not owned(n) and n!='plugin.yml'];assert all(old.read(n)==new.read(n) for n in untouched)
proof={'version':'0.1.5','sha256':sha(a.output.read_bytes()),'baselineSha256':sha(a.baseline.read_bytes()),'unrelatedEntriesPreserved':len(untouched),'changedEntries':sorted(changes),'productionChanged':False}
a.output.with_suffix('.build.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof))
