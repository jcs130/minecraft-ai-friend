"""Compile only the loopback test stimulus, never part of a production artifact."""
from pathlib import Path
import argparse, subprocess, tempfile, zipfile
p=argparse.ArgumentParser()
for arg in ['classpath-file','javac','output']:p.add_argument('--'+arg,type=Path,required=True)
a=p.parse_args()
with tempfile.TemporaryDirectory(prefix='companion-qa-') as temp:
 root=Path(temp);classes=root/'classes';classes.mkdir()
 args=['--release','21','-encoding','UTF-8','-proc:none','-cp',a.classpath_file.read_text(encoding='utf-8-sig').strip(),'-d',str(classes),str(Path(__file__).with_name('CompanionStateQa.java'))]
 argfile=root/'javac.args';argfile.write_text('\n'.join('"'+v.replace('\\','/')+'"' for v in args),encoding='utf-8')
 subprocess.run([str(a.javac),'-J-Duser.language=en','@'+str(argfile)],check=True)
 with zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED) as jar:
  jar.writestr('plugin.yml','name: CompanionStateQA\nversion: 1\nmain: local.tlmcompat.qa.CompanionStateQa\napi-version: "1.21"\ndepend: [QiandengjiMaidBridge]\ncommands:\n  companionqa:\n    description: Synthetic loopback fixture only\n')
  for file in classes.rglob('*.class'):jar.write(file,file.relative_to(classes).as_posix())
 print('Synthetic companion fixture built')
