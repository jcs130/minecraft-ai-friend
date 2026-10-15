"""Build a server-only FOM login adapter using the existing PlayerAuthBridge source."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,tempfile,zipfile
REPO=Path(__file__).resolve().parents[1]
SOURCE=REPO/'world/fom-support-src'
AUTH=REPO/'world/society-bridge-src/src/main/java/dev/qiandeng/maw/PlayerAuthBridge.java'
REGISTRY=AUTH.with_name('NativeRegistryDump.java')

def build(server,java,output):
    server,output=Path(server).resolve(),Path(output).resolve()
    libs=server/'libraries'
    mapped=libs/'net/minecraft/server/1.21.1-20240808.144430/server-1.21.1-20240808.144430-srg.jar'
    neo=libs/'net/neoforged/neoforge/21.1.248/neoforge-21.1.248-universal.jar'
    patched=libs/'net/neoforged/neoforge/21.1.248/neoforge-21.1.248-server.jar'
    assert mapped.is_file() and neo.is_file() and patched.is_file(),'Exact Minecraft/NeoForge cache required'
    cp=list(dict.fromkeys([patched,mapped,neo,*sorted(libs.rglob('*.jar'))]))
    sources=[AUTH,REGISTRY,*sorted((SOURCE/'src').rglob('*.java'))]
    output.mkdir(parents=True,exist_ok=False)
    with tempfile.TemporaryDirectory(prefix='compile-',dir=output) as temp:
        classes=Path(temp)/'classes';classes.mkdir()
        quote=lambda p:'"'+str(p).replace('\\','/')+'"'
        args=Path(temp)/'javac.args'
        args.write_text('\n'.join(['-proc:none','--release','21','-encoding','UTF-8','-cp',quote(os.pathsep.join(map(str,cp))),'-d',quote(classes),*map(quote,sources)]),encoding='utf-8')
        result=subprocess.run([str(Path(java).with_name('javac.exe')),'-J-Duser.language=en','-J-Dfile.encoding=UTF-8','@'+str(args)],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=180)
        (output/'compile.log').write_text(result.stdout+result.stderr,encoding='utf-8')
        if result.returncode:raise RuntimeError(result.stderr[-5000:])
        jar=output/'maw-fom-support-0.2.0.jar'
        with zipfile.ZipFile(jar,'x',zipfile.ZIP_DEFLATED) as archive:
            for root in (classes,SOURCE/'resources'):
                for path in sorted(root.rglob('*')):
                    if path.is_file():
                        info=zipfile.ZipInfo(path.relative_to(root).as_posix(),(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
                        archive.writestr(info,path.read_bytes())
    sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    record={'schemaVersion':1,'jar':str(jar),'sha256':sha(jar),'minecraft':'1.21.1','neoforge':'21.1.248','serverOnly':True,'clientRequired':False,
        'reusedAuthSource':str(AUTH.relative_to(REPO)),'reusedAuthSourceSha256':sha(AUTH),
        'sources':{str(p.relative_to(REPO)):sha(p) for p in [Path(__file__),*sources,*sorted((SOURCE/'resources').rglob('*'))] if p.is_file()}}
    (output/'build-record.json').write_text(json.dumps(record,indent=2),encoding='utf-8');return record

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ('server','java','output'):parser.add_argument('--'+key,type=Path,required=True)
    a=parser.parse_args();r=build(a.server,a.java,a.output);print(json.dumps({k:r[k] for k in ('jar','sha256','serverOnly','clientRequired')}))
