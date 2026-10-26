"""Normal start/stop of the marked loopback protection fixture, never production."""
from pathlib import Path
import subprocess,time,socket,json,sys,hashlib
STAGE=Path('E:/MC/staging/aincrad-protection-20261027')
def main():
    label=sys.argv[1];assert label.isalnum()
    assert 'motd=QD_AINCRAD_PROTECTION_QA_ONLY' in (STAGE/'server.properties').read_text()
    logpath=STAGE/('qa-'+label+'.log');assert not logpath.exists()
    for port in (25928,25929):
        with socket.socket() as s:s.bind(('127.0.0.1',port))
    result={'label':label,'ready':False,'sha256':hashlib.sha256((STAGE/'plugins/AgentFriend-0.4.47.17.jar').read_bytes()).hexdigest()};p=None
    try:
        with logpath.open('w',encoding='utf8') as log:
            p=subprocess.Popen(['E:/MC/jdk/jdk-21.0.12.1+1/bin/java.exe','-Xms512M','-Xmx2048M','-XX:ActiveProcessorCount=2','-Dfile.encoding=UTF-8','-jar','server.jar','--nogui'],cwd=STAGE,stdin=subprocess.PIPE,stdout=log,stderr=subprocess.STDOUT,text=True)
            for _ in range(180):
                if p.poll() is not None:break
                if 'Done (' in logpath.read_text(encoding='utf8',errors='replace'):result['ready']=True;break
                time.sleep(1)
            if result['ready']:
                client=Path(__file__).with_name('client.mjs')
                r=subprocess.run(['node',str(client.resolve()),label],cwd=STAGE,capture_output=True,text=True,encoding='utf8',errors='replace',timeout=180)
                (STAGE/('client-'+label+'.stdout')).write_text(r.stdout,encoding='utf8')
                (STAGE/('client-'+label+'.stderr')).write_text(r.stderr,encoding='utf8')
                result['clientExit']=r.returncode;result['clientSummary']=r.stdout[-900:];result['clientError']=r.stderr[-900:]
    finally:
        if p and p.poll() is None:
            p.stdin.write('stop\n');p.stdin.flush()
            try:p.wait(timeout=60)
            except subprocess.TimeoutExpired:p.terminate();p.wait(timeout=15);result['forcedStop']=True
        result['exitCode']=p.returncode if p else None
        result['errors']=[l for l in logpath.read_text(encoding='utf8',errors='replace').splitlines() if any(k in l for k in ('ERROR','QDQA_ERROR','Exception','Block access reload rejected'))][-18:]
        (STAGE/('qa-'+label+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps(result,ensure_ascii=True))
    return 0 if result['ready'] and result.get('clientExit')==0 and result['exitCode']==0 and not result.get('forcedStop') else 1
if __name__=='__main__':raise SystemExit(main())
