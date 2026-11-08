"""Reviewed class overlay; never writes to a running server."""
from pathlib import Path
import argparse,hashlib,json,subprocess,tempfile,zipfile
p=argparse.ArgumentParser()
for key in ['baseline','classpath-file','javac','output']:p.add_argument('--'+key,type=Path,required=True)
a=p.parse_args();assert a.baseline.resolve()!=a.output.resolve()
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(a.baseline)=='5f801267739d08a41d294d20dbcf5ef804cc1c3416bdabfd9cfba90f3b8a93a1','Review changed production baseline'
names=['HybridMaidPlugin','NativeMaidAgentSupport','NativeMaidSocialSupport','NativeMaidNearbyChat','NativeMaidSpeech','NativeMaidCompanionSupport','NativeMaidOwnerTravel','MaidCompanionPolicy','MaidConversationWindow','MaidChatReply']
prefix='local/tlmcompat/hybrid/';root=Path(__file__).parent
replace=lambda n:any(n==prefix+c+'.class' or n.startswith(prefix+c+'$') for c in names)
a.output.parent.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='companion-build-',dir=a.output.parent) as tmp:
 temp=Path(tmp);args=['--release','21','-encoding','UTF-8','-proc:none','-cp',str(a.baseline)+';'+a.classpath_file.read_text(encoding='utf-8-sig').strip(),'-d',str(temp/'classes')]+[str(root/'hybrid-src'/prefix/(n+'.java')) for n in names]
 argfile=temp/'javac.args';argfile.write_text('\n'.join('"'+s.replace('\\','/')+'"' for s in args),encoding='utf-8')
 subprocess.run([str(a.javac),'-J-Duser.language=en','-J-Dfile.encoding=UTF-8','@'+str(argfile)],check=True)
 with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED) as out:
  for e in old.infolist():
   if replace(e.filename):continue
   content=old.read(e.filename)
   if e.filename=='plugin.yml':content=('\n'.join('version: 0.1.14-companion' if s.startswith('version:') else s for s in content.decode().splitlines())+'\n').encode()
   out.writestr(e,content)
  for f in sorted((temp/'classes').rglob('*.class')):
   name=f.relative_to(temp/'classes').as_posix()
   if replace(name):e=zipfile.ZipInfo(name,(2026,11,8,0,0,0));e.compress_type=zipfile.ZIP_DEFLATED;out.writestr(e,f.read_bytes())
 with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(a.output) as new:
  untouched=[n for n in old.namelist() if n!='plugin.yml' and not replace(n)]
  assert all(old.read(n)==new.read(n) for n in untouched)
 print(json.dumps({'artifact':str(a.output),'sha256':sha(a.output),'unrelatedEntriesPreserved':len(untouched)}))
