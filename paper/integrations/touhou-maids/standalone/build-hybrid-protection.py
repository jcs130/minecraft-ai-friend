"""Build only the NPC land adapter over an existing AgentFriend JAR; never deploy or copy saves."""
import argparse, hashlib, json, os, subprocess, tempfile, zipfile
from pathlib import Path

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ('server','base','jdk','output'):p.add_argument('--'+key,type=Path,required=True)
    a=p.parse_args();out=a.output.resolve();base=a.base.resolve()
    if out==base or out.is_relative_to(a.server.resolve()):p.error('output must be separate from the server and baseline')
    root=Path(__file__).resolve().parents[3]/'plugins/AgentFriend/src/org/afuhome/agentfriend'
    names=('AgentFriendPlugin','LandAccess','NativeResidentIdentities')
    sources=[root/(name+'.java')for name in names]
    out.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=out.parent)as tmp:
        tmp=Path(tmp);classes=tmp/'classes';empty=tmp/'empty';empty.mkdir()
        cp=os.pathsep.join(map(str,[base,*a.server.glob('libraries/**/*.jar'),*a.server.glob('plugins/*.jar')]))
        args=['--release','21','-encoding','UTF-8','-proc:none','-implicit:none','-sourcepath',empty,'-cp',cp,'-d',classes,*sources]
        argfile=tmp/'args';argfile.write_text('\n'.join('"'+str(x).replace('\\','/')+'"'for x in args),encoding='utf-8')
        subprocess.run([a.jdk/'bin/javac.exe','@'+str(argfile)],check=True)
        updates={x.relative_to(classes).as_posix():x.read_bytes()for x in classes.rglob('*.class')}
        with zipfile.ZipFile(base)as old:
            entries={name:old.read(name)for name in old.namelist()if not name.endswith('/')}
        for name in updates:
            assert name.rsplit('/',1)[-1].split('$')[0].removesuffix('.class')in names
        original=dict(entries);entries.update(updates)
        with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED)as archive:
            for name,data in sorted(entries.items()):
                info=zipfile.ZipInfo(name,(2026,11,16,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
                archive.writestr(info,data)
    sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
    result={'artifact':out.name,'sha256':sha(out),'baseSha256':sha(base),'productionChanged':False,
        'changedEntries':[name for name,data in original.items()if entries[name]!=data],
        'addedEntries':sorted(set(entries)-set(original)),
        'sources':{x.name:sha(x)for x in sources}}
    out.with_suffix('.build.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result))
if __name__=='__main__':main()
