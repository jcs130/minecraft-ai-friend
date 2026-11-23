"""Build the grave-marker delta over the pinned deployed native platform mod; never installs.

Baseline is the deployed platform JAR recorded in paper/manifests/current-deployment.json
(sha256 9e9c2bd6...). Only VanillaMaidView is recompiled so that a vanilla-protocol client receives a
maid tombstone as a named standing marker instead of an anonymous projectile. Every other entry is
preserved byte-for-byte; the mod descriptor version is the only other change.
"""
import argparse,copy,hashlib,json,re,subprocess,tempfile,zipfile
from pathlib import Path

BASE_SHA256='9e9c2bd6ecfb73e7a48a5bffef74ed33dd8b3d75ec7cc449dec19297262fb965'
BASE_VERSION,VERSION=b'0.1.7',b'0.1.8'
CLASS='local/tlmcompat/numen/VanillaMaidView.class'
DESCRIPTOR='META-INF/neoforge.mods.toml'

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--baseline',type=Path,required=True);p.add_argument('--classpath-file',type=Path,required=True)
    p.add_argument('--javac',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    assert a.baseline.resolve()!=a.output.resolve()
    sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
    assert sha(a.baseline)==BASE_SHA256,'Unexpected baseline; re-audit before rebuilding'
    source=Path(__file__).parent/'platform-src'/'local/tlmcompat/numen/VanillaMaidView.java'
    a.output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=a.output.parent,prefix='grave-view-build-') as tmp:
        temp=Path(tmp);separator=';' if ';' in a.classpath_file.read_text(encoding='utf-8-sig') else ':'
        cp=separator.join([str(a.baseline.resolve()),a.classpath_file.read_text(encoding='utf-8-sig').strip()])
        args=['--release','21','-encoding','UTF-8','-proc:none','-implicit:none','-classpath',cp,'-d',str(temp/'classes'),str(source)]
        options=temp/'javac.args';options.write_text('\n'.join('"'+s.replace('\\','/')+'"' for s in args),encoding='utf-8')
        subprocess.run([str(a.javac),'-J-Duser.language=en','@'+str(options)],check=True)
        compiled={f.relative_to(temp/'classes').as_posix():f.read_bytes() for f in (temp/'classes').rglob('*.class')}
        assert set(compiled)=={CLASS},'Only the reviewed view class may change: '+str(sorted(compiled))
        with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(a.output,'x',zipfile.ZIP_DEFLATED) as new:
            descriptor,count=re.subn(rb'(?m)^version="'+re.escape(BASE_VERSION)+rb'"$',b'version="'+VERSION+b'"',old.read(DESCRIPTOR))
            assert count==1,'Descriptor version changed; re-audit the baseline'
            changes={CLASS:compiled[CLASS],DESCRIPTOR:descriptor}
            for entry in old.infolist():new.writestr(copy.copy(entry),changes.get(entry.filename,old.read(entry.filename)))
        with zipfile.ZipFile(a.baseline) as old,zipfile.ZipFile(a.output) as new:
            assert old.namelist()==new.namelist()
            changed=sorted(name for name in old.namelist() if old.read(name)!=new.read(name))
            assert changed==sorted(changes),changed
            preserved=len(old.namelist())-len(changed)
    print(json.dumps({'artifact':a.output.name,'sha256':sha(a.output),'baselineSha256':BASE_SHA256,'changedEntries':changed,
                      'otherEntriesPreserved':preserved,'sourceSha256':sha(source),'productionChanged':False}))

if __name__=='__main__':main()
