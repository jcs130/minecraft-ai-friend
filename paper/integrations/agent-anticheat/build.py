from pathlib import Path
import argparse,os,subprocess,zipfile
p=argparse.ArgumentParser();p.add_argument('--server',type=Path,required=True);p.add_argument('--lac',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--fixture',action='store_true');a=p.parse_args()
root=Path(__file__).resolve().parent;classes=a.output.parent/('antifixture-classes'if a.fixture else'antiguard-classes');classes.mkdir(exist_ok=True,parents=True)
source=[root/'probe/AntiFixture.java']if a.fixture else list((root/'src').rglob('*.java'))
cp=os.pathsep.join(map(str,[a.lac,*a.server.glob('libraries/**/*.jar')]))
r=subprocess.run(['E:/MC/jdk/jdk-21.0.12.1+1/bin/javac.exe','-J-Duser.language=en','-proc:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',str(classes),*map(str,source)],capture_output=True)
if r.returncode:print(r.stderr.decode('utf8',errors='replace'));raise SystemExit(r.returncode)
with zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED)as z:
 for f in classes.rglob('*.class'):z.write(f,f.relative_to(classes).as_posix())
 if a.fixture:z.writestr('plugin.yml','name: AntiFixture\nversion: 1.0\nmain: org.qiandengji.qa.AntiFixture\napi-version: "1.21"\ndepend: [QiandengjiAntiCheat, AgentFriend]\ncommands:\n  acqa: {}\n')
 else:z.write(root/'plugin.yml','plugin.yml')
print(a.output.name)
