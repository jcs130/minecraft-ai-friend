"""Build only the reviewed cast pre-dispatch settlement delta over the pinned deployed bridge.

Baseline is the deployed 0.1.64-lifecycle-async JAR. Both changed classes were verified
byte-identical to main before the fix, so the candidate is exactly deployed + this review.
"""
import argparse,hashlib,os,subprocess,tempfile,zipfile
from pathlib import Path

BASE_SHA256='f24186685b88b748eb10564a961b906ccc5e07fe935ba5d8488b031d81551bd7'
VERSION='0.1.65-cast-predispatch'
CLASSES=('MaidBodyControl','NativeMaidBodyActions')

def main():
    p=argparse.ArgumentParser();p.add_argument('--baseline',type=Path,required=True);p.add_argument('--classpath-file',type=Path,required=True);p.add_argument('--javac',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    assert a.baseline.resolve()!=a.output.resolve()
    assert hashlib.sha256(a.baseline.read_bytes()).hexdigest()==BASE_SHA256,'Unexpected baseline; re-audit before rebuilding'
    root=Path(__file__).parent;package='local/tlmcompat/hybrid/'
    a.output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=a.output.parent,prefix='maid-cast-build-') as tmp:
        temp=Path(tmp);cp=os.pathsep.join([str(a.baseline.resolve()),a.classpath_file.read_text(encoding='utf-8-sig').strip()])
        args=['--release','21','-encoding','UTF-8','-proc:none','-classpath',cp,'-d',str(temp/'classes')]+[str(root/'hybrid-src'/package/(c+'.java')) for c in CLASSES]
        options=temp/'javac.args';options.write_text('\n'.join('"'+s.replace('\\','/')+'"' for s in args),encoding='utf-8')
        subprocess.run([str(a.javac),'-J-Duser.language=en','@'+str(options)],check=True)
        compiled={p.relative_to(temp/'classes').as_posix():p.read_bytes() for p in (temp/'classes').rglob('*.class')}
        replaced=lambda name:any(name==package+c+'.class' or name.startswith(package+c+'$') for c in CLASSES)
        assert all(package+c+'.class' in compiled for c in CLASSES),'Expected classes were not built'
        with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(a.output,'x',zipfile.ZIP_DEFLATED) as new:
            for e in old.infolist():
                if replaced(e.filename):continue
                content=old.read(e.filename)
                if e.filename=='plugin.yml':content=('\n'.join('version: '+VERSION if s.startswith('version:') else s for s in content.decode().splitlines())+'\n').encode()
                new.writestr(e,content)
            for name,content in sorted(compiled.items()):
                e=zipfile.ZipInfo(name,(2026,11,22,0,0,0));e.compress_type=zipfile.ZIP_DEFLATED;new.writestr(e,content)
        with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(a.output) as new:
            untouched=[n for n in old.namelist() if n!='plugin.yml' and not replaced(n)]
            assert all(old.read(n)==new.read(n) for n in untouched)
        print(f'{a.output.name}: {hashlib.sha256(a.output.read_bytes()).hexdigest()}; {len(untouched)} unrelated entries preserved')

if __name__=='__main__':main()