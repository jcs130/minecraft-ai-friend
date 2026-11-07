"""Build the native brain selector over the pinned deployed close-follow bridge."""
import argparse,hashlib,os,subprocess,tempfile,zipfile
from pathlib import Path

BASE_SHA256='e4787d8cf7b43ec0b0426391ecc8dfaf881be70dd89a2ac6f21723eb2d6d3147'
VERSION='0.1.10-harness'
CLASSES=('HybridMaidPlugin','NativeMaidAgentSupport','NativeMaidBrainSupport','MaidBrainToolGuard')

def main():
    p=argparse.ArgumentParser();p.add_argument('--baseline',type=Path,required=True);p.add_argument('--classpath-file',type=Path,required=True);p.add_argument('--javac',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--extension-output',type=Path,required=True);a=p.parse_args()
    assert a.baseline.resolve()!=a.output.resolve()
    assert hashlib.sha256(a.baseline.read_bytes()).hexdigest()==BASE_SHA256,'Unexpected baseline; re-audit before rebuilding'
    root=Path(__file__).parent;package='local/tlmcompat/hybrid/'
    a.output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=a.output.parent,prefix='maid-life-build-') as tmp:
        temp=Path(tmp);base_cp=a.classpath_file.read_text(encoding='utf-8-sig').strip()
        extension_args=['--release','21','-encoding','UTF-8','-proc:none','-classpath',base_cp,'-d',str(temp/'extension')]+[str(file) for file in sorted((root/'brain-extension/src').rglob('*.java'))]
        extension_options=temp/'extension.args';extension_options.write_text('\n'.join('"'+s.replace('\\','/')+'"' for s in extension_args),encoding='utf-8')
        subprocess.run([str(a.javac),'-J-Duser.language=en','@'+str(extension_options)],check=True)
        a.extension_output.parent.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(a.extension_output,'w',zipfile.ZIP_DEFLATED) as archive:
            content={file.relative_to(temp/'extension').as_posix():file.read_bytes() for file in (temp/'extension').rglob('*.class')}
            content['META-INF/neoforge.mods.toml']=(root/'brain-extension/neoforge.mods.toml').read_text(encoding='utf-8').replace('\r\n','\n').encode('utf-8')
            for name,data in sorted(content.items()):
                info=zipfile.ZipInfo(name,(2026,11,7,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(info,data)
        cp=str(a.extension_output.resolve())+os.pathsep+str(a.baseline.resolve())+os.pathsep+base_cp
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
        print(f'{a.extension_output.name}: {hashlib.sha256(a.extension_output.read_bytes()).hexdigest()}; server-only original TLM extension')

if __name__=='__main__':main()
