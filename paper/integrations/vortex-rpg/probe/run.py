"""Runs only the marked loopback candidate; stdout fixture commands stay here."""
from pathlib import Path
import argparse,json,subprocess,time,socket,threading,re
STAGE=Path('E:/MC/staging/vortex-mmo-20261027')
def main():
 p=argparse.ArgumentParser();p.add_argument('--label',required=True);p.add_argument('--cold',action='store_true');p.add_argument('--account',default='ag_VortexQA');p.add_argument('--bedrock',action='store_true');a=p.parse_args()
 assert re.fullmatch('ag_VortexQA[0-9]{0,3}',a.account)
 assert re.fullmatch('[a-z0-9]{1,24}',a.label)
 assert 'motd=QD_VORTEX_MMO_QA_ONLY' in (STAGE/'server.properties').read_text()
 with socket.socket()as s:s.bind(('127.0.0.1',25926))
 logpath=STAGE/f'run-{a.label}.log';assert not logpath.exists()
 result={'productionChanged':False,'ready':False,'label':a.label};server=None;client=None
 try:
  with logpath.open('w',encoding='utf8')as log:
   server=subprocess.Popen(['E:/MC/jdk/jdk-21.0.12.1+1/bin/java.exe','-Xms512M','-Xmx1536M','-XX:ActiveProcessorCount=2','-Dfile.encoding=UTF-8','-jar','server.jar','--nogui'],cwd=STAGE,stdin=subprocess.PIPE,stdout=log,stderr=subprocess.STDOUT,text=True,encoding='utf8')
   for _ in range(150):
    time.sleep(1);text=logpath.read_text(encoding='utf8',errors='replace')
    if server.poll()is not None:raise RuntimeError('QA exited during startup')
    if 'Done (' in text:result['ready']=True;break
   if not result['ready']:raise TimeoutError('QA startup timeout')
   if 'Error occurred while enabling QiandengjiRpg' in text or '拒绝双重RPG权威' in text:raise RuntimeError('Adapter did not enable')
   server.stdin.write('gamerule doMobSpawning false\ngamerule doDaylightCycle false\nweather clear\ntime set day\n');server.stdin.flush()
   script=Path(__file__).with_name('client.mjs');output=STAGE/f'client-{a.label}.json'
   with (STAGE/f'client-{a.label}.stderr.log').open('w',encoding='utf8')as stderr:
    client=subprocess.Popen(['C:/Users/lzl19/AppData/Local/hermes/node/node.exe',str(script),str(output),'cold'if a.cold else'seed',a.account],cwd=STAGE,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=stderr,text=True,encoding='utf8')
    deadline=time.monotonic()+180
    def terminate_late():
     if client.poll()is None:client.terminate()
    timer=threading.Timer(180,terminate_late);timer.start()
    try:
     for line in client.stdout:
      if line.startswith('QA_COMMAND '):
       request=json.loads(line[len('QA_COMMAND '):]);command=request['command']
       assert (command.startswith(('tp '+a.account+' ','give '+a.account+' ','summon minecraft:zombie ','effect give '+a.account+' ','setblock ','kill @e[type=minecraft:zombie','data get entity '+a.account+' ')))and'\n'not in command
       server.stdin.write(command+'\n');server.stdin.flush();client.stdin.write(json.dumps({'ack':request['id']})+'\n');client.stdin.flush()
    finally:timer.cancel()
    client.wait(timeout=15);result['clientExit']=client.returncode
   result['clientReport']=json.loads(output.read_text(encoding='utf8'))
   if a.bedrock:
    bedrock=STAGE/f'bedrock-{a.label}.json'
    probe=subprocess.run(['C:/Users/lzl19/AppData/Local/hermes/node/node.exe',str(Path(__file__).with_name('bedrock.mjs')),bedrock.as_posix()],capture_output=True,timeout=100)
    result['bedrockExit']=probe.returncode
    (STAGE/f'bedrock-{a.label}.stderr.log').write_bytes(probe.stderr)
    result['bedrockReport']=json.loads(bedrock.read_text(encoding='utf8'))
 finally:
  if client is not None and client.poll()is None:client.terminate();client.wait(timeout=10)
  if server is not None and server.poll()is None:
   server.stdin.write('stop\n');server.stdin.flush()
   try:server.wait(timeout=60)
   except subprocess.TimeoutExpired:result['normalStop']=False;server.terminate();server.wait(timeout=15)
  result.setdefault('normalStop',server is not None and server.returncode==0)
  result['logErrors']=[line for line in logpath.read_text(encoding='utf8',errors='replace').splitlines()if 'ERROR' in line or 'Exception' in line][-15:]
  (STAGE/f'result-{a.label}.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
  print(json.dumps({'ready':result['ready'],'normalStop':result['normalStop'],'clientExit':result.get('clientExit'),'checks':len(result.get('clientReport',{}).get('checks',[])),'logErrors':len(result['logErrors'])}))
 if result.get('clientExit')!=0 or result.get('bedrockExit',0)!=0 or not result['normalStop']:raise SystemExit(1)
if __name__=='__main__':main()
