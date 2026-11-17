"""Replace only native world permissions over the reviewed live bridge; never install."""
import argparse, hashlib, os, re, subprocess, tempfile, zipfile
from pathlib import Path

BASE='7e9a8de37c57e21a4ac68c7e7b284e2603e307e3ae9636c1a6bfe362239a53a0'
FAMILY='local/tlmcompat/hybrid/NativeWorldPermissions'

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('server','baseline','javac','output'):p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args()
    if hashlib.sha256(a.baseline.read_bytes()).hexdigest()!=BASE:raise ValueError('Unreviewed bridge baseline')
    if a.output.resolve().is_relative_to((a.server/'plugins').resolve()):raise ValueError('Build outside live plugins')
    cp=os.pathsep.join(map(str,[a.baseline,*a.server.glob('libraries/**/*.jar'),*a.server.glob('mods/*.jar'),*a.server.glob('plugins/*.jar')]))
    with tempfile.TemporaryDirectory(prefix='resident-permission-build-') as d:
        d=Path(d);options=['--release','21','-encoding','UTF-8','-proc:none','-classpath',cp,'-d',str(d/'classes'),'-implicit:none',str(Path(__file__).parent/'hybrid-src'/(FAMILY+'.java'))]
        (d/'javac.args').write_text('\n'.join('"'+x.replace('\\','/')+'"' for x in options),encoding='utf8')
        subprocess.run([str(a.javac),'-J-Duser.language=en','@'+str(d/'javac.args')],check=True)
        compiled={f.relative_to(d/'classes').as_posix():f.read_bytes() for f in (d/'classes').rglob('*.class')}
        assert set(compiled)=={FAMILY+'.class'}
        with zipfile.ZipFile(a.baseline) as z:entries={n:z.read(n) for n in z.namelist() if not n.endswith('/')}
        original=entries.copy();entries.update(compiled)
        descriptor,count=re.subn(r'(?m)^version:.*$','version: 0.1.40-resident-permissions',entries['plugin.yml'].decode())
        if count!=1:raise ValueError('Missing version')
        entries['plugin.yml']=descriptor.encode()
        assert all(entries[n]==data for n,data in original.items() if n not in {FAMILY+'.class','plugin.yml'})
        a.output.parent.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED) as z:
            for name,data in sorted(entries.items()):
                entry=zipfile.ZipInfo(name,(2026,11,17,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;z.writestr(entry,data)
    print(hashlib.sha256(a.output.read_bytes()).hexdigest()+'  '+a.output.name)

if __name__=='__main__':main()
