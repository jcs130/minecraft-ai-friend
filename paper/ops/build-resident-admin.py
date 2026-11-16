"""Build the resident service adapter against an explicitly reviewed existing server JAR."""
import argparse, hashlib, os, re, subprocess, tempfile, zipfile
from pathlib import Path

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('server','base','javac','output'):parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--base-sha256',required=True)
    args=parser.parse_args()
    if hashlib.sha256(args.base.read_bytes()).hexdigest()!=args.base_sha256:raise ValueError('base JAR digest mismatch')
    if args.output.resolve().is_relative_to((args.server/'plugins').resolve()):raise ValueError('build outside the live plugin directory')
    source=Path(__file__).resolve().parents[1]/'plugins/AgentFriend/src/org/afuhome/agentfriend'
    names=['AgentFriendPlugin','PhotoCameraManager','PublicArchives','ResidentCli','CompanionTravelAccess']
    cp=os.pathsep.join(map(str,[args.base,*args.server.glob('libraries/**/*.jar'),*args.server.glob('plugins/*.jar')]))
    with tempfile.TemporaryDirectory(prefix='resident-admin-build-')as folder:
        work=Path(folder);classes=work/'classes';arguments=['--release','21','-encoding','UTF-8','-proc:none','-cp',cp,'-d',str(classes),*[str(source/(n+'.java'))for n in names]]
        argfile=work/'compiler.args';argfile.write_text('\n'.join('"'+a.replace('\\','/')+'"'for a in arguments),encoding='utf-8')
        subprocess.run([str(args.javac),'-J-Duser.language=en','@'+str(argfile)],check=True)
        with zipfile.ZipFile(args.base)as archive:entries={n:archive.read(n)for n in archive.namelist()if not n.endswith('/')}
        descriptor,count=re.subn(r'(?m)^version:.*$',"version: '0.4.47.83-resident-admin'",entries['plugin.yml'].decode('utf-8'))
        if count!=1:raise ValueError('plugin version declaration missing')
        entries['plugin.yml']=descriptor.encode('utf-8')
        for file in classes.rglob('*.class'):entries[file.relative_to(classes).as_posix()]=file.read_bytes()
        args.output.parent.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(args.output,'w')as archive:
            for name,data in sorted(entries.items()):
                entry=zipfile.ZipInfo(name,(2026,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(entry,data)
    print(hashlib.sha256(args.output.read_bytes()).hexdigest()+'  '+args.output.name)

if __name__=='__main__':main()
