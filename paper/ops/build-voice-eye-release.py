"""Reproducible, narrowly scoped release builds; no installation or game actions."""
from pathlib import Path
import argparse,hashlib,json,os,re,subprocess,sys,zipfile

REPO=Path(__file__).resolve().parents[2]
PINS={
 'eye':('plugins/CortiEyeMirror-0.1.19.jar','a7730c35827c0cb4f03a12b7d03c51316c0c2444c071c4fab4d975f027cf7dcb'),
 'voice':('plugins/QiandengVoice-0.1.0.jar','61e414af4b44f476eaafd9b34777015e6cede46ce3dd53156c4c12893a8a999c'),
 'login':('plugins/LoginGuard-0.1.10.jar','91057a35ec75897f06c755bdeb60a48e05d9e59a93c7fe131adec510cc225a66'),
}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(*args,**kwargs):return subprocess.run([str(x) for x in args],check=True,**kwargs)
def pack(output,entries):
 with zipfile.ZipFile(output,'x',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
  for name,data in sorted(entries.items()):
   info=zipfile.ZipInfo(name,(2026,11,10,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,data)
def narrow(base,built,target,families,version):
 owned=lambda n:any(n==f+'.class' or n.startswith(f+'$') for f in families)
 with zipfile.ZipFile(base) as z:old={n:z.read(n) for n in z.namelist()}
 with zipfile.ZipFile(built) as z:replacement={n:z.read(n) for n in z.namelist() if owned(n)}
 assert replacement and all(any(n==f+'.class' for n in replacement) for f in families)
 entries={n:b for n,b in old.items() if not owned(n)};entries.update(replacement)
 if 'plugin.yml' in entries:
  entries['plugin.yml'],count=re.subn(rb'(?m)^version:.*$',('version: '+version).encode(),entries['plugin.yml']);assert count==1
 else:
  data=json.loads(entries['velocity-plugin.json']);data['version']=version;entries['velocity-plugin.json']=json.dumps(data,separators=(',',':')).encode()
 pack(target,entries)
 preserved=[n for n in old if not owned(n) and n not in ('plugin.yml','velocity-plugin.json')]
 with zipfile.ZipFile(target) as z:assert all(old[n]==z.read(n) for n in preserved)
 return {'sha256':sha(target),'preservedEntries':len(preserved),'families':families,'version':version}
def main():
 p=argparse.ArgumentParser(description=__doc__)
 for key in ['server','proxy','jdk','output']:p.add_argument('--'+key,type=Path,required=True)
 a=p.parse_args();out=a.output.resolve()
 assert not out.exists() and not any(out.is_relative_to(x.resolve()) for x in [a.server,a.proxy]),'Fresh non-runtime output required'
 paths={k:(a.server if k in ('eye','voice') else a.proxy)/v[0] for k,v in PINS.items()}
 for k,path in paths.items():assert sha(path)==PINS[k][1],f'Unreviewed input {k}'
 out.mkdir(parents=True);candidate=out/'candidate';candidate.mkdir();reports={}
 run(sys.executable,REPO/'paper/ops/build-eye-hud-baseline.py','--server-root',a.server,'--base',paths['eye'],'--expected-base-sha256',PINS['eye'][1],'--jdk',a.jdk,'--version','0.1.21-hud-baseline','--output',candidate/'CortiEyeMirror.jar')
 reports['eye']={'sha256':sha(candidate/'CortiEyeMirror.jar'),'version':'0.1.21-hud-baseline','preservedEntries':27}
 svc=a.server/'plugins/voicechat-bukkit-2.6.27.jar'
 run(sys.executable,REPO/'paper/integrations/proximity-voice/build.py','--paper',a.server,'--svc',svc,'--jdk',a.jdk,'--out',out/'voice-full')
 reports['voice']=narrow(paths['voice'],out/'voice-full/QiandengVoice-0.1.6.jar',candidate/'QiandengVoice.jar',['dev/god/godvoice/'+n for n in ('PaperVoicePlugin','VoiceUploads','VoiceUploadTrace')],'0.1.6')
 run(sys.executable,REPO/'paper/integrations/login-guard/build.py','--proxy',a.proxy,'--jdk',a.jdk,'--output',out/'login-full')
 reports['login']=narrow(paths['login'],out/'login-full/LoginGuard-0.1.13.jar',candidate/'LoginGuard.jar',['org/afuhome/auth/'+n for n in ('LoginGuard','VoiceTransportTrace','VerifiedJavaIdentity')]+['org/afuhome/identity/'+n for n in ('PlatformIdentity','IdentityHandoff')],'0.1.13-platform-identity')
 (out/'build.json').write_text(json.dumps({'productionChanged':False,'baselines':{k:dict(path=str(paths[k]),sha256=PINS[k][1]) for k in paths},'artifacts':reports},indent=2)+'\n')
 print(json.dumps(reports))
if __name__=='__main__':main()
