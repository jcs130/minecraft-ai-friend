"""Bounded loopback canary, with normal shutdown in all cases. Never runs production."""
from pathlib import Path
import argparse,json,subprocess,time,socket,hashlib

def main():
    p=argparse.ArgumentParser();p.add_argument('--client',type=Path);p.add_argument('--label',default='first');a=p.parse_args()
    stage=Path('E:/MC/staging/aincrad-conquest-20261027')
    assert 'motd=QD_AINCRAD_CONQUEST_QA_ONLY' in (stage/'server.properties').read_text()
    assert a.label.isalnum()
    if (stage/f'qa-{a.label}.log').exists() or (stage/f'client-{a.label}.json').exists():
        raise ValueError('label already used; preserve previous evidence and choose another label')
    for port in (25924,25925):
        with socket.socket() as s:s.bind(('127.0.0.1',port))
    logpath=stage/f'qa-{a.label}.log';proc=None;result={'productionModified':False,'label':a.label,'ready':False,
        'candidateSha256':hashlib.sha256((stage/'plugins/AgentFriend-0.4.48.jar').read_bytes()).hexdigest()}
    try:
        with logpath.open('w',encoding='utf8') as log:
            proc=subprocess.Popen(['E:/MC/jdk/jdk-21.0.12.1+1/bin/java.exe','-Xms512M','-Xmx2048M','-XX:ActiveProcessorCount=2','-Dfile.encoding=UTF-8','-jar','server.jar','--nogui'],
                cwd=stage,stdin=subprocess.PIPE,stdout=log,stderr=subprocess.STDOUT,text=True)
            for _ in range(180):
                if proc.poll() is not None:break
                text=logpath.read_text(encoding='utf8',errors='replace')
                if 'Done (' in text:
                    result['ready']=True;break
                time.sleep(1)
            if result['ready']:
                proc.stdin.write('mycli admin dungeons audit\nmycli admin worldlife audit\n');proc.stdin.flush()
                if a.client:
                    r=subprocess.run(['node',str(a.client.resolve()),a.label],cwd=stage,capture_output=True,text=True,encoding='utf8',errors='replace',timeout=360)
                    (stage/f'client-{a.label}.stdout').write_text(r.stdout,encoding='utf8');(stage/f'client-{a.label}.stderr').write_text(r.stderr,encoding='utf8')
                    result['clientExit']=r.returncode;result['clientSummary']=r.stdout[-1600:];result['clientError']=r.stderr[-600:]
                    result['clientProtocolWarningCount']=r.stdout.count('PartialReadError:')+r.stderr.count('PartialReadError:')
                else:time.sleep(3)
    finally:
        if proc is not None and proc.poll() is None:
            try:proc.stdin.write('stop\n');proc.stdin.flush();proc.wait(timeout=60)
            except (OSError,subprocess.TimeoutExpired):proc.terminate();proc.wait(timeout=15)
        text=logpath.read_text(encoding='utf8',errors='replace')
        result['exitCode']=proc.returncode if proc else None
        result['errors']=[line for line in text.splitlines() if any(t in line for t in ['ERROR','Exception','retained:','unavailable;','QDQA_ERROR','NoSuchField'])][-18:]
        (stage/f'qa-{a.label}.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps(result,ensure_ascii=True))
    return 0 if result['ready'] and result.get('clientExit',0)==0 and result['exitCode']==0 else 1

if __name__=='__main__':raise SystemExit(main())
