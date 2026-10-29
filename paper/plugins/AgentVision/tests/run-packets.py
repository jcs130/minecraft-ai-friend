"""Normal-start/normal-stop protocol verification against the existing isolated
AgentVision fixture. Never connects to, starts or stops a production server."""
from pathlib import Path
import argparse, json, re, socket, subprocess, time

p=argparse.ArgumentParser()
p.add_argument('--stage',type=Path,required=True)
p.add_argument('--evidence',type=Path,required=True)
p.add_argument('--runtime-package',type=Path,required=True)
p.add_argument('--java',type=Path,required=True)
p.add_argument('--node',type=Path,required=True)
a=p.parse_args()
props=(a.stage/'server.properties').read_text()
for key,value in [('server-ip','127.0.0.1'),('server-port','25982'),('rcon.port','25983')]:
 assert re.search(r'^'+re.escape(key)+'='+re.escape(value)+r'\r?$',props,re.M),key
assert a.stage.resolve().as_posix().startswith('E:/MC/staging/'), 'explicit isolated workspace only'
for port in [25982,25983]:
 with socket.socket() as sock:sock.bind(('127.0.0.1',port))
a.evidence.mkdir(parents=True,exist_ok=False)
# The old lifecycle fixture used four chunks, which legitimately unloads the
# 66-block target before the filter is exercised. Widen only this QA view and
# restore the exact original properties after normal shutdown.
props_path=a.stage/'server.properties'
original_properties=props_path.read_bytes()
props_path.write_text(re.sub(r'^view-distance=\d+\r?$', 'view-distance=7', props, flags=re.M),encoding='utf8')
logpath=a.evidence/'server.log';report={'ready':False,'productionModified':False}
with logpath.open('w',encoding='utf8') as log:
 process=subprocess.Popen([str(a.java),'-Xms512M','-Xmx1536M','-XX:ActiveProcessorCount=2','-Dfile.encoding=UTF-8','-jar','server.jar','--nogui'],cwd=a.stage,stdin=subprocess.PIPE,stdout=log,stderr=subprocess.STDOUT,text=True)
 try:
  for _ in range(180):
   if process.poll() is not None:break
   if 'Done (' in logpath.read_text(encoding='utf8',errors='replace'):
    report['ready']=True;break
   time.sleep(1)
  if not report['ready']:raise RuntimeError('isolated server failed to start')
  with (a.evidence/'client.log').open('w',encoding='utf8') as clientlog:
   result=subprocess.run([str(a.node),str(Path(__file__).with_name('raw-packets.mjs')),str(a.stage),str(a.evidence/'client.json'),str(a.runtime_package)],stdout=clientlog,stderr=subprocess.STDOUT,timeout=180)
   report['clientExit']=result.returncode
 finally:
  if process.poll() is None:
   process.stdin.write('stop\n');process.stdin.flush()
   try:process.wait(timeout=90)
   except subprocess.TimeoutExpired:
    report['shutdownTimedOut']=True;process.terminate();process.wait(timeout=15)
  report['exitCode']=process.returncode
  props_path.write_bytes(original_properties)
  (a.evidence/'result.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
print(json.dumps(report))
raise SystemExit(0 if report['ready'] and report.get('clientExit')==0 and report['exitCode']==0 else 1)
