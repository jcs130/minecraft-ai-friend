"""Explicitly launch the dedicated renderer. No model, game controls or reconnect loop."""
import argparse
import json
from pathlib import Path
import subprocess

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--game',type=Path,required=True)
    parser.add_argument('--java',type=Path,required=True,help='Dedicated Java runtime, never the shared server executable')
    parser.add_argument('--server',help='Explicit numeric/hostname server:port; omit to test renderer without connecting')
    args=parser.parse_args()
    root=args.game.resolve();java=args.java.resolve()
    if not java.is_file():raise SystemExit('Dedicated Java runtime is missing')
    manifest=json.loads((root/'launch.json').read_text())
    if not any((root/'mods').glob('qiandeng-native-camera-*.jar')):raise SystemExit('Build/install the camera policy first')
    arguments=['-Dqiandeng.camera.enabled=true','-Dqiandeng.camera.hidden=true']+manifest['arguments']
    if args.server:
        host,port=args.server.rsplit(':',1)
        if not host or not 1<=int(port)<=65535:raise SystemExit('Expected explicit server:port')
        arguments+=['--server',host,'--port',port]
    log=(root/'native-camera.log').open('ab')
    process=subprocess.Popen([str(java)]+arguments,cwd=root,stdout=log,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    print(json.dumps({'pid':process.pid,'started':True,'verified':False,'note':'Require fresh Intel/shader/YSM telemetry before accepting photos'}))

if __name__=='__main__':main()
