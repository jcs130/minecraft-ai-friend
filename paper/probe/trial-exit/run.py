"""Run only synthetic Youer fixtures; never change or stop the production server."""
from pathlib import Path
import argparse, json, os, secrets, shutil, socket, subprocess, time
p=argparse.ArgumentParser(description=__doc__)
for n in ('source','build','output','mineflayer-package'):p.add_argument('--'+n,type=Path,required=True)
a=p.parse_args();a.output.mkdir(parents=True,exist_ok=False)
assert json.loads((a.source/'fixture.json').read_text())['synthetic']
assert (a.source/'.companion-dungeons-qa').is_file()
stage=a.output/'isolated'
def copy(src,dst):
    # Only immutable dependencies share hardlinks; worlds and configuration are real copies.
    if Path(src).suffix=='.jar':
        try:os.link(src,dst);return dst
        except OSError:pass
    return shutil.copy2(src,dst)
shutil.copytree(a.source,stage,copy_function=copy,ignore=shutil.ignore_patterns('session.lock','*.log','*-wal','*-shm','.paper-remapped'))
(stage/'.trial-exit-qa').write_text('SYNTHETIC_TRIAL_EXIT_ONLY')
plugins=stage/'plugins'
for jar in plugins.glob('*.jar'):
    if jar.name.startswith('numen') or jar.name in ('maid-vortex-qa.jar','QiandengVoice.jar','DailyGameplayQa.jar'):jar.unlink()
def replace(src,dst):
    if dst.exists():dst.unlink()  # Break the fixture hardlink before replacing a JAR.
    shutil.copyfile(src,dst)
replace(a.build/'TrialExitQa.jar',plugins/'TrialExitQa.jar')
replace(Path('E:/MC/server/plugins/qiandengji-maid-native-0.1.12-conversation.jar'),plugins/'qiandengji-maid-native.jar')
voice=plugins/'voicechat/voicechat-server.properties'
voice.write_text('bind_address=127.0.0.1\nport=26463\nvoice_host=127.0.0.1:26463\nforce_voice_chat=false\nallow_pings=false\n')
props=stage/'server.properties'
data=dict(x.split('=',1) for x in props.read_text().splitlines() if '=' in x and not x.startswith('#'))
data.update({'server-ip':'127.0.0.1','server-port':'26461','rcon.port':'26462','rcon.password':secrets.token_hex(20),'enable-rcon':'true','online-mode':'false'})
props.write_text(''.join(k+'='+v+'\n' for k,v in data.items()))
for port,kind in ((26461,socket.SOCK_STREAM),(26462,socket.SOCK_STREAM),(26463,socket.SOCK_DGRAM)):
    with socket.socket(type=kind) as sock:sock.bind(('127.0.0.1',port))
cmd=['E:/MC/jdk/jdk-21.0.12.1+1/bin/java.exe','-Xms384M','-Xmx2304M','-XX:ActiveProcessorCount=2','-Dfile.encoding=UTF-8','-jar','server.jar','--nogui']
env=dict(os.environ,TRIAL_EXIT_STAGE=str(stage),MINEFLAYER_PACKAGE=str(a.mineflayer_package))
for phase in ('baseline','candidate','restart','cleared-restart','final-smoke'):
    if phase in ('baseline','candidate'):
        replace(Path('E:/MC/server/plugins/AgentFriend-0.4.47.59-shop-rpg.jar') if phase=='baseline' else a.build/'AgentFriend-0.4.47.76-trial-return.jar',plugins/'AgentFriend.jar')
    log_path=a.output/(phase+'-server.log')
    with log_path.open('wb') as log:
        proc=subprocess.Popen(cmd,cwd=stage,stdin=subprocess.PIPE,stdout=log,stderr=subprocess.STDOUT,
                              creationflags=subprocess.CREATE_NO_WINDOW|subprocess.BELOW_NORMAL_PRIORITY_CLASS)
        (a.output/(phase+'-process.json')).write_text(json.dumps({'pid':proc.pid,'cwd':str(stage),'command':cmd}))
        try:
            until=time.monotonic()+180
            while 'Done (' not in log_path.read_text(encoding='utf8',errors='replace'):
                if proc.poll() is not None or time.monotonic()>until:raise RuntimeError('Fixture startup failed')
                time.sleep(1)
            subprocess.run(['C:/Users/lzl19/AppData/Local/hermes/node/node.exe',str(Path(__file__).with_name('probe.mjs')),phase],env=env,check=True,timeout=200)
        finally:
            if proc.poll() is None:
                proc.stdin.write(b'stop\n');proc.stdin.flush();proc.wait(timeout=90)
            if proc.returncode!=0:raise RuntimeError('Fixture shutdown failed')
    print('NORMAL_STOP '+phase,flush=True)
