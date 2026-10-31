"""Narrowly align the common ability catalog in the reviewed cooperation bridge."""
from pathlib import Path
import argparse,hashlib,os,re,subprocess,zipfile
p=argparse.ArgumentParser();p.add_argument('--base',type=Path,required=True);p.add_argument('--jdk',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
assert hashlib.sha256(a.base.read_bytes()).hexdigest()=='3ecd856c78c72b092658b2a2aee7b57c19e98ca7ac706c06d6f2c21da00d28f6','Unreviewed cooperation bridge'
assert not a.output.exists(),'Use a fresh build directory';a.output.mkdir(parents=True)
source=Path(__file__).parent/'src/org/qiandengji/vortex/SkillTransition.java';classes=a.output/'classes';classes.mkdir()
subprocess.run([str(a.jdk/'bin'/('javac.exe'if os.name=='nt'else'javac')),'--release','21','-encoding','UTF-8','-d',str(classes),str(source)],check=True)
with zipfile.ZipFile(a.base)as z:entries={i.filename:z.read(i)for i in z.infolist()if not i.is_dir()}
before=dict(entries);name='org/qiandengji/vortex/SkillTransition.class';assert name in entries
entries[name]=(classes/name).read_bytes();meta=entries['plugin.yml'].decode();meta,n=re.subn(r'(?m)^(version:\s*[\'\"]?)0\.2\.14([\'\"]?\s*)$',r'\g<1>0.2.15\2',meta);assert n==1;entries['plugin.yml']=meta.encode()
assert {k for k in entries if entries[k]!=before[k]}=={name,'plugin.yml'}
jar=a.output/'QiandengjiRpg-0.2.15.jar'
with zipfile.ZipFile(jar,'w',zipfile.ZIP_DEFLATED)as z:
    for name,data in entries.items():
        i=zipfile.ZipInfo(name,(2026,10,31,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;z.writestr(i,data)
print('QiandengjiRpg 0.2.15 sha256='+hashlib.sha256(jar.read_bytes()).hexdigest()+'; only common catalog and version changed')
