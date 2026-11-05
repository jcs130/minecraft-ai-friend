"""Launch the dedicated resident renderer; photo jobs reuse it. No model or control loop."""
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
    hidden=True
    arguments=['-Dqiandeng.camera.enabled=true']+manifest['arguments']
    # The monitor is prepared separately by the operator. This only places the
    # camera window; it never installs a driver or moves another window.
    display_profile=root/'native-camera-display.json'
    if display_profile.is_file():
        display=json.loads(display_profile.read_text(encoding='utf-8-sig'))
        if display.get('schema')!=1 or display.get('expectedGpu') not in ('Intel','RTX3080Ti'):raise SystemExit('Unreviewed camera display profile')
        expected='intel' if display['expectedGpu']=='Intel' else 'rtx3080ti'
        arguments=['-Dqiandeng.camera.expectedGpu='+expected]+arguments
        coordinates=[display.get('windowX'),display.get('windowY')]
        if not all(type(value)is int and -32768<=value<=32767 for value in coordinates):raise SystemExit('Invalid camera monitor coordinates')
        arguments=['-Dqiandeng.camera.windowX='+str(coordinates[0]),'-Dqiandeng.camera.windowY='+str(coordinates[1])]+arguments
        if display.get('graphicsBackend') not in (None,'mesa-d3d12','native-opengl'):raise SystemExit('Unreviewed camera graphics backend')
        if expected=='rtx3080ti' and (display.get('graphicsBackend')!='native-opengl' or (java.parent/'opengl32.dll').exists()):raise SystemExit('RTX camera requires the native driver and a dedicated clean Java runtime')
        if display.get('graphicsBackend')=='native-opengl':hidden=False
        if display.get('graphicsBackend')=='mesa-d3d12':
            hidden=False
            arguments=['-Dqiandeng.camera.mesaIntelAdapter=true']+arguments
    arguments=['-Dqiandeng.camera.hidden='+str(hidden).lower()]+arguments
    if args.server:
        host,port=args.server.rsplit(':',1)
        if not host or not 1<=int(port)<=65535:raise SystemExit('Expected explicit server:port')
        # 1.21.1 removed the old --server/--port launch options. They are ignored
        # by the permissive parser and leave a renderer at the title screen.
        arguments+=['--quickPlayMultiplayer',host+':'+port]
    log=(root/'native-camera.log').open('ab')
    flags=getattr(subprocess,'CREATE_NO_WINDOW',0)
    if '-Dqiandeng.camera.expectedGpu=rtx3080ti' in arguments:
        flags|=getattr(subprocess,'BELOW_NORMAL_PRIORITY_CLASS',0)
    process=subprocess.Popen([str(java)]+arguments,cwd=root,stdout=log,stderr=subprocess.STDOUT,creationflags=flags)
    print(json.dumps({'pid':process.pid,'started':True,'verified':False,'lifetime':'resident','note':'Require fresh configured-GPU/YSM telemetry matching the shader policy before accepting photos'}))

if __name__=='__main__':main()
