"""Small public-dialogue patch over the exact deployed Harness bridge; no mod changes."""
import argparse,hashlib,subprocess,tempfile,zipfile
from pathlib import Path

BASE_SHA256='9c43d8b48414b9eb6d5495c1a7b7c7d49c96649f2d6341cb0ded0c582871b699'
VERSION='0.1.11-social'
CLASSES=('HybridMaidPlugin','NativeMaidAgentSupport','NativeMaidSocialSupport','NativeMaidTransport')

def main():
    p=argparse.ArgumentParser();p.add_argument('--baseline',type=Path,required=True);p.add_argument('--classpath-file',type=Path,required=True);p.add_argument('--extension',type=Path,required=True);p.add_argument('--javac',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    assert a.baseline.resolve()!=a.output.resolve()
    assert hashlib.sha256(a.baseline.read_bytes()).hexdigest()==BASE_SHA256,'Unexpected deployed baseline'
    root=Path(__file__).parent;package='local/tlmcompat/hybrid/';a.output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=a.output.parent,prefix='maid-social-build-') as tmp:
        temp=Path(tmp);cp=str(a.extension.resolve())+';'+str(a.baseline.resolve())+';'+a.classpath_file.read_text(encoding='utf-8-sig').strip()
        args=['--release','21','-encoding','UTF-8','-proc:none','-classpath',cp,'-d',str(temp/'classes')]+[str(root/'hybrid-src'/package/(c+'.java')) for c in CLASSES]
        options=temp/'javac.args';options.write_text('\n'.join('"'+s.replace('\\','/')+'"' for s in args),encoding='utf-8')
        subprocess.run([str(a.javac),'-J-Duser.language=en','@'+str(options)],check=True)
        compiled={p.relative_to(temp/'classes').as_posix():p.read_bytes() for p in (temp/'classes').rglob('*.class')}
        replaced=lambda name:any(name==package+c+'.class' or name.startswith(package+c+'$') for c in CLASSES)
        with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED) as new:
            for e in old.infolist():
                if replaced(e.filename):continue
                content=old.read(e.filename)
                if e.filename=='plugin.yml':content=('\n'.join('version: '+VERSION if s.startswith('version:') else s for s in content.decode().splitlines())+'\n').encode()
                new.writestr(e,content)
            for name,content in sorted(compiled.items()):
                e=zipfile.ZipInfo(name,(2026,11,7,0,0,0));e.compress_type=zipfile.ZIP_DEFLATED;new.writestr(e,content)
        with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(a.output) as new:
            untouched=[n for n in old.namelist() if n!='plugin.yml' and not replaced(n)]
            assert all(old.read(n)==new.read(n) for n in untouched)
        print(f'{a.output.name}: {hashlib.sha256(a.output.read_bytes()).hexdigest()}; {len(untouched)} unrelated entries preserved')

if __name__=='__main__':main()
