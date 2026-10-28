"""Compile the console-only fixture for the explicitly marked local QA server."""
from pathlib import Path
import argparse, os, socket, subprocess, zipfile
p=argparse.ArgumentParser()
p.add_argument('--stage',type=Path,required=True)
p.add_argument('--vortex',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
a=p.parse_args()
assert (a.stage/'.qa-only').read_text()=='VORTEX_TAKEOVER_QA_ONLY'
assert not a.output.exists()
with socket.socket()as s:s.bind(('127.0.0.1',25928))
classes=a.output.with_suffix('.build');classes.mkdir()
cp=os.pathsep.join(map(str,[a.vortex,*a.stage.rglob('libraries/**/*.jar')]))
subprocess.run(['E:/MC/jdk/jdk-21.0.12.1+1/bin/javac.exe','-proc:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',str(classes),str(Path(__file__).with_name('UsabilityQA.java'))],check=True)
with zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED)as z:
 for f in classes.rglob('*.class'):z.write(f,f.relative_to(classes).as_posix())
 z.writestr('plugin.yml','name: UsabilityQA\nversion: 0.0.3-qa-only\nmain: org.qiandengji.usabilityqa.UsabilityQA\napi-version: "1.21"\ndepend: [VortexRPG]\ncommands:\n  qduse:\n    permission: qduse.console\npermissions:\n  qduse.console:\n    default: op\n')
print(a.output.name)
