"""Reproducible client-only JAR; use an explicit installed NeoForge 21.1.248 cache."""
from pathlib import Path
import argparse, hashlib, json, os, subprocess, tempfile, zipfile

HERE=Path(__file__).resolve().parent
def build(minecraft: Path, javac: Path, output: Path):
    libraries=minecraft/'libraries'
    required=[libraries/'net/neoforged/neoforge/21.1.248/neoforge-21.1.248-client.jar',
              libraries/'net/minecraft/client/1.21.1-20240808.144430/client-1.21.1-20240808.144430-srg.jar',
              libraries/'net/neoforged/neoforge/21.1.248/neoforge-21.1.248-universal.jar']
    if not all(p.is_file() for p in required): raise ValueError('Install the official NeoForge 21.1.248 client first')
    # Exact cache JARs only; patched client must precede unpatched slim/extra inputs.
    cp=list(dict.fromkeys(required+sorted(libraries.rglob('*.jar'))))
    sources=sorted((HERE/'src').rglob('*.java'))
    output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='compile-',dir=output) as temp:
        classes=Path(temp)/'classes';classes.mkdir()
        quote=lambda p:'"'+str(p).replace('\\','/')+'"'
        args=Path(temp)/'javac.args'
        args.write_text('\n'.join(['-proc:none','--release','21','-encoding','UTF-8','-cp',quote(os.pathsep.join(map(str,cp))),
                                  '-d',quote(classes),*(quote(p) for p in sources)]),encoding='utf-8')
        result=subprocess.run([str(javac),'@'+str(args)],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=180)
        (output/'compile.log').write_text(result.stdout+result.stderr,encoding='utf-8')
        if result.returncode: raise RuntimeError(result.stderr[-9000:])
        jar=output/'maw-client-bridge-0.3.0-neoforge-1.21.1.jar'
        with zipfile.ZipFile(jar,'w',zipfile.ZIP_DEFLATED) as z:
            for root in [classes,HERE/'resources']:
                for p in sorted(root.rglob('*')):
                    if p.is_file():
                        entry=zipfile.ZipInfo(p.relative_to(root).as_posix(),(1980,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED
                        z.writestr(entry,p.read_bytes())
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    record={'schemaVersion':1,'version':'0.3.0','minecraft':'1.21.1','neoforge':'21.1.248','clientOnly':True,
            'serverRequired':False,'customPayloadChannels':[],'jar':str(jar),'sha256':digest(jar),
            'sources':{p.relative_to(HERE).as_posix():digest(p) for p in [HERE/'build.py',*sources,*sorted((HERE/'resources').rglob('*'))] if p.is_file()},
            'classpath':{str(p):digest(p) for p in cp}}
    (output/'build-record.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
    return record
if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--minecraft',type=Path,required=True);ap.add_argument('--javac',type=Path,required=True);ap.add_argument('--output',type=Path,required=True)
    a=ap.parse_args();r=build(a.minecraft,a.javac,a.output);print(json.dumps({k:r[k] for k in ('jar','sha256','clientOnly','serverRequired')}))
