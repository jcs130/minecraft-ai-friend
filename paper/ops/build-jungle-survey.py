"""Build only the temple survey geometry and guidance over the pinned live .69 JAR."""
from pathlib import Path
import argparse,hashlib,json,subprocess,tempfile,zipfile

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('baseline','classpath-file','javac','output'):
        p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args()
    expected='2fc7d9d8b14efa6c8404a1146de31fe14e9d8055fe4b91c96e5bd3817435750a'
    version='0.4.47.70-jungle-survey-rpg'
    assert a.baseline.resolve()!=a.output.resolve() and not a.output.exists()
    assert hashlib.sha256(a.baseline.read_bytes()).hexdigest()==expected,'Review changed live baseline'
    root=Path(__file__).resolve().parents[1]/'plugins/AgentFriend'
    prefix='org/afuhome/agentfriend/'
    names=['ExplorationObjectives','ExplorationGuidance']
    owned=lambda name:any(name==prefix+n+'.class' or name.startswith(prefix+n+'$') for n in names)
    a.output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='temple-survey-',dir=a.output.parent) as temporary:
        temporary=Path(temporary)
        args=['--release','21','-encoding','UTF-8','-proc:none','-implicit:none','-classpath',
              str(a.baseline)+';'+a.classpath_file.read_text(encoding='utf-8-sig').strip(),
              '-d',str(temporary/'classes'),*[str(root/'src'/prefix/(n+'.java')) for n in names]]
        options=temporary/'args'
        options.write_text('\n'.join('"'+v.replace('\\','/')+'"' for v in args),encoding='utf8')
        subprocess.run([str(a.javac),'-J-Duser.language=en','@'+str(options)],check=True)
        compiled={f.relative_to(temporary/'classes').as_posix():f.read_bytes() for f in (temporary/'classes').rglob('*.class')}
        assert compiled and all(owned(n) for n in compiled)
        with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED) as new:
            for entry in old.infolist():
                if owned(entry.filename):continue
                content=old.read(entry.filename)
                if entry.filename=='plugin.yml':
                    assert content.count(b'0.4.47.69-onboarding-viewer-rpg')==1
                    content=content.replace(b'0.4.47.69-onboarding-viewer-rpg',version.encode())
                new.writestr(entry,content)
            for name,content in sorted(compiled.items()):
                entry=zipfile.ZipInfo(name,(2026,11,10,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED
                new.writestr(entry,content)
        with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(a.output) as new:
            preserved=[n for n in old.namelist() if n!='plugin.yml' and not owned(n)]
            assert all(old.read(n)==new.read(n) for n in preserved)
    print(json.dumps({'version':version,'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),
                      'baselineSha256':expected,'unrelatedEntriesPreserved':len(preserved),'installed':False}))

if __name__=='__main__':main()
