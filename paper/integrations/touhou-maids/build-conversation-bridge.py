"""Build a narrowly scoped increment over the actual social bridge."""
import argparse,hashlib,subprocess,tempfile,zipfile
from pathlib import Path

BASE_SHA256='ad55d45c86035940ac3741a1ba15ac2fbb8196e735cc91e88cf3d7173965ed57'
VERSION='0.1.12-conversation'
CLASSES=('HybridMaidPlugin','NativeMaidSocialSupport','NativeMaidNearbyChat','MaidAddressing','NativeMaidSpeech','MaidSpeechLines')

def main():
    p=argparse.ArgumentParser();p.add_argument('--baseline',type=Path,required=True);p.add_argument('--classpath-file',type=Path,required=True);p.add_argument('--extension-output',type=Path,required=True);p.add_argument('--svc',type=Path,required=True);p.add_argument('--javac',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    assert a.baseline.resolve()!=a.output.resolve()
    assert hashlib.sha256(a.baseline.read_bytes()).hexdigest()==BASE_SHA256,'Unexpected deployed baseline'
    root=Path(__file__).parent;package='local/tlmcompat/hybrid/';a.output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=a.output.parent,prefix='maid-conversation-build-') as tmp:
        temp=Path(tmp);base_cp=a.classpath_file.read_text(encoding='utf-8-sig').strip()
        args=['--release','21','-encoding','UTF-8','-proc:none','-classpath',base_cp,'-d',str(temp/'extension')]+[str(p) for p in sorted((root/'brain-extension/src').rglob('*.java'))]
        options=temp/'extension.args';options.write_text('\n'.join('"'+s.replace('\\','/')+'"' for s in args),encoding='utf-8')
        subprocess.run([str(a.javac),'-J-Duser.language=en','@'+str(options)],check=True)
        extension={p.relative_to(temp/'extension').as_posix():p.read_bytes() for p in (temp/'extension').rglob('*.class')}
        for name,path in [('META-INF/neoforge.mods.toml','neoforge.mods.toml'),('qiandengji-maid-brain.mixins.json','qiandengji-maid-brain.mixins.json')]:extension[name]=(root/'brain-extension'/path).read_bytes()
        a.extension_output.parent.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(a.extension_output,'w',zipfile.ZIP_DEFLATED) as output:
            for name,content in sorted(extension.items()):
                entry=zipfile.ZipInfo(name,(2026,11,7,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;output.writestr(entry,content)
        cp=str(a.extension_output.resolve())+';'+str(a.baseline.resolve())+';'+str(a.svc.resolve())+';'+base_cp
        args=['--release','21','-encoding','UTF-8','-proc:none','-classpath',cp,'-d',str(temp/'classes')]+[str(root/'hybrid-src'/package/(c+'.java')) for c in CLASSES]
        options=temp/'javac.args';options.write_text('\n'.join('"'+s.replace('\\','/')+'"' for s in args),encoding='utf-8')
        subprocess.run([str(a.javac),'-J-Duser.language=en','@'+str(options)],check=True)
        compiled={p.relative_to(temp/'classes').as_posix():p.read_bytes() for p in (temp/'classes').rglob('*.class')}
        replaced=lambda name:any(name==package+c+'.class' or name.startswith(package+c+'$') for c in CLASSES)
        with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED) as new:
            for e in old.infolist():
                if replaced(e.filename):continue
                content=old.read(e.filename)
                if e.filename=='plugin.yml':
                    lines=content.decode().splitlines()
                    dependency=next((s for s in lines if s.startswith('softdepend:')),None)
                    assert dependency is not None and dependency.endswith(']'),'Review existing optional dependencies'
                    lines=[s[:-1]+', voicechat, Essentials, EssentialsChat]' if s==dependency else s for s in lines]
                    content=('\n'.join('version: '+VERSION if s.startswith('version:') else s for s in lines)+'\n').encode()
                new.writestr(e,content)
            for name,content in sorted(compiled.items()):
                e=zipfile.ZipInfo(name,(2026,11,7,0,0,0));e.compress_type=zipfile.ZIP_DEFLATED;new.writestr(e,content)
        with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(a.output) as new:
            untouched=[n for n in old.namelist() if n!='plugin.yml' and not replaced(n)]
            assert all(old.read(n)==new.read(n) for n in untouched)
        print(f'{a.output.name}: {hashlib.sha256(a.output.read_bytes()).hexdigest()}; {len(untouched)} unrelated entries preserved')
        print(f'{a.extension_output.name}: {hashlib.sha256(a.extension_output.read_bytes()).hexdigest()}')

if __name__=='__main__':main()
