"""Build a separate companion, preserving every byte of the live LoginGuard JAR."""
import argparse, hashlib, json, subprocess, zipfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--proxy',type=Path,required=True);p.add_argument('--jdk',type=Path,required=True);p.add_argument('--libre',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parent
assert not a.out.exists();a.out.mkdir(parents=True);classes=a.out/'classes';classes.mkdir()
expected={a.proxy/'velocity.jar':'fe53021f3168322cb6cb68f78699866fd098df3c306e4359847a10b0d02689ef',
 a.proxy/'plugins/LoginGuard-0.1.5.jar':'a55dd131e4f44c1de28e199701dffd2d8876151fbf7bab54e6598ef592c4a32c',
 a.libre:'3df848d4058e63f37cf9fe997542fd49c84374440d116a34ac4052278aa77e4f'}
for f,h in expected.items():assert hashlib.sha256(f.read_bytes()).hexdigest()==h,str(f)
deps=[a.proxy/'velocity.jar',a.libre,*sorted((a.proxy/'plugins/librelogin/lib').rglob('*.jar'))]
sources=[*root.joinpath('java').rglob('*.java'),*root.joinpath('velocity').rglob('*.java')]
subprocess.run([str(a.jdk/'bin/javac.exe'),'-proc:none','-encoding','UTF-8','--release','21','-cp',';'.join(map(str,deps)),'-d',str(classes),*map(str,sources)],check=True)
jar=a.out/'RealmAccounts-0.1.1.jar'
with zipfile.ZipFile(jar,'w',zipfile.ZIP_DEFLATED) as z:
 for f in sorted(classes.rglob('*.class')):z.write(f,f.relative_to(classes).as_posix())
 z.writestr('velocity-plugin.json',json.dumps({'id':'realm-accounts','name':'Shared Realm Accounts','version':'0.1.1','main':'dev.qiandeng.accounts.RealmAuthority','dependencies':[{'id':'login-guard','optional':False},{'id':'librelogin','optional':False}]}))
(a.out/'build.json').write_text(json.dumps({'sha256':hashlib.sha256(jar.read_bytes()).hexdigest(),'unchangedDependencies':{str(f):h for f,h in expected.items()}},indent=2))
print('Built separate RealmAccounts companion; original LoginGuard unchanged')
