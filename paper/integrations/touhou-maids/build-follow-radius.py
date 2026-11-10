"""Build per-maid follow distances over the pinned single-dialogue bridge. Does not install."""
import argparse,hashlib,json,subprocess,tempfile,zipfile
from pathlib import Path

BASE_SHA256='0ceb98805025155d89f13788bf67ecfb9385c228b899f5a821d09d02f49690c1'
VERSION='0.1.23-follow-radius'
FAMILIES=['local/tlmcompat/hybrid/'+name for name in ['HybridMaidPlugin','NativeMaidFollowSupport','MaidFollowPolicy']]

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['baseline','classpath-file','javac','output']:p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args()
    assert a.baseline.resolve()!=a.output.resolve()
    assert not a.output.exists(),'Never overwrite an earlier candidate'
    assert hashlib.sha256(a.baseline.read_bytes()).hexdigest()==BASE_SHA256,'Unexpected baseline; re-audit before rebuilding'
    a.output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=a.output.parent,prefix='maid-follow-build-') as temporary:
        work=Path(temporary)
        args=['--release','21','-encoding','UTF-8','-proc:none','-classpath',
              str(a.baseline.resolve())+';'+a.classpath_file.read_text(encoding='utf-8-sig').strip(),
              '-d',str(work/'classes'),'-implicit:none',*[str(Path(__file__).parent/'hybrid-src'/(family+'.java')) for family in FAMILIES]]
        options=work/'javac.args'
        options.write_text('\n'.join('"'+s.replace('\\','/')+'"' for s in args),encoding='utf8')
        subprocess.run([str(a.javac),'-J-Duser.language=en','@'+str(options)],check=True)
        compiled={f.relative_to(work/'classes').as_posix():f.read_bytes() for f in (work/'classes').rglob('*.class')}
        owned=lambda name:any(name==family+'.class' or name.startswith(family+'$') for family in FAMILIES)
        assert compiled and all(owned(name) for name in compiled)
        with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED) as new:
            for entry in old.infolist():
                if owned(entry.filename):continue
                content=old.read(entry.filename)
                if entry.filename=='plugin.yml':
                    content=('\n'.join('version: '+VERSION if line.startswith('version:') else line
                                       for line in content.decode().splitlines())+'\n').encode()
                new.writestr(entry,content)
            for name,content in sorted(compiled.items()):
                entry=zipfile.ZipInfo(name,(2026,11,11,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED
                new.writestr(entry,content)
        with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(a.output) as new:
            preserved=[name for name in old.namelist() if name!='plugin.yml' and not owned(name)]
            assert all(old.read(name)==new.read(name) for name in preserved)
    print(json.dumps({'version':VERSION,'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),
                      'preservedEntries':len(preserved),'replacedFamilies':FAMILIES,'installed':False}))

if __name__=='__main__':main()
