"""Build exact native candidates outside the server; never install them."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile

ROOT=Path(__file__).resolve().parents[3]
BASE='39f2cae4794542bfdc36dcb7fc5c24ba781598a6497f17b8a4362a598eff1ac9'
OWNERS=['HybridMaidPlugin','MaidBodyControl','NativeMaidBodyPort','NativeMaidBodyActions','NativeMaidCompanionSupport']

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def archive(path,entries):
    with zipfile.ZipFile(path,'x',zipfile.ZIP_DEFLATED)as z:
        for name,value in sorted(entries.items()):
            info=zipfile.ZipInfo(name,(2026,11,17,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,value)
def compile(javac,cp,sources,work):
    classes=work/'classes';args=['--release','21','-encoding','UTF-8','-proc:none','-implicit:none','-cp',os.pathsep.join(map(str,cp)),'-d',str(classes),*map(str,sources)]
    file=work/'compiler.args';file.write_text('\n'.join('"'+a.replace('\\','/')+'"'for a in args),encoding='utf8')
    subprocess.run([str(javac),'-J-Duser.language=en','@'+str(file)],check=True)
    return {p.relative_to(classes).as_posix():p.read_bytes()for p in classes.rglob('*.class')}
def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('server','maid-baseline','resident-jar','combat-dependencies','javac','output'):
        p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args();server=a.server.resolve();out=a.output.resolve()
    if out.is_relative_to(server)or digest(a.maid_baseline)!=BASE:raise ValueError('unreviewed_baseline_or_live_output')
    out.mkdir(parents=True,exist_ok=True)
    libraries=sorted(server.glob('libraries/**/*.jar'));patched=[x for x in libraries if x.name.startswith('neoforge-')and x.name.endswith('-server.jar')]
    deps=sorted(x for x in a.combat_dependencies.glob('*.jar') if x.name.startswith(('bettercombat-','cloth-config-','player-animation-lib-')))
    if not any(x.name.startswith('bettercombat-')for x in deps):raise ValueError('reviewed_combat_compile_dependency_required')
    source=ROOT/'paper/integrations/touhou-maids/hybrid-src/local/tlmcompat/hybrid'
    with tempfile.TemporaryDirectory(dir=out)as tmp:
        updates=compile(a.javac,[a.resident_jar,a.maid_baseline,*libraries,*server.glob('mods/*.jar'),*server.glob('plugins/*.jar')],[source/(n+'.java')for n in OWNERS],Path(tmp))
    if not updates or any(not n.startswith('local/tlmcompat/hybrid/')or n.rsplit('/',1)[1].split('$')[0].removesuffix('.class')not in OWNERS for n in updates):raise ValueError('unexpected_compiled_class')
    with zipfile.ZipFile(a.maid_baseline)as z:entries={n:z.read(n)for n in z.namelist()if not n.endswith('/')}
    entries.update(updates);entries['plugin.yml']=re.sub(rb'(?m)^version:.*$',b'version: 0.1.45-unified-residents',entries['plugin.yml'])
    maid=out/'QiandengjiMaidBridge-0.1.45-unified-residents.jar';archive(maid,entries)
    source=ROOT/'paper/integrations/numen-hosting/native-bridge'
    with tempfile.TemporaryDirectory(dir=out)as tmp:entries=compile(a.javac,[*patched,*libraries,*deps],sorted((source/'src').rglob('*.java')),Path(tmp))
    entries['META-INF/neoforge.mods.toml']=(source/'neoforge.mods.toml').read_bytes()
    entries['qiandengji-hosted.mixins.json']=(source/'qiandengji-hosted.mixins.json').read_bytes()
    hosted=out/'qiandengji-hosted-bridge-0.1.1.jar';archive(hosted,entries)
    report={'productionInstalled':False,'baselineSha256':BASE,'artifacts':{p.name:digest(p)for p in(maid,hosted)},'compileDependencies':{p.name:digest(p)for p in deps}}
    (out/'build.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))
if __name__=='__main__':main()
