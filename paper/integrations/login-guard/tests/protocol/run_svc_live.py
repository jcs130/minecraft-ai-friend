"""Fresh loopback-only SVC routing lab. Never copies accounts, worlds or credentials."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import zipfile
from run_live import wait_for, stop, PINNED

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['inputs', 'deps', 'classes', 'baseline-classes', 'node-package', 'output', 'svc-jar']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--java', default='java')
    parser.add_argument('--node', default='node')
    parser.add_argument('--proxy-port', type=int, default=25891)
    parser.add_argument('--paper-port', type=int, default=25892)
    parser.add_argument('--udp-port', type=int, default=25943)
    args = parser.parse_args()
    out = args.output.resolve()
    if out.exists() or out == REPO or REPO in out.parents:
        parser.error('Fresh output directory outside the repository required')
    if 'eula=true' not in (args.inputs / 'eula.txt').read_text():
        parser.error('Existing EULA-accepted Paper runtime required')
    deps = [args.deps.resolve() / name for name in PINNED]
    for jar in deps:
        if hashlib.sha256(jar.read_bytes()).hexdigest() != PINNED[jar.name]:
            parser.error('Unreviewed dependency: ' + jar.name)
    if hashlib.sha256(args.svc_jar.read_bytes()).hexdigest() != 'b2fab978bfd891576d6d2417b2886228493db30e9ffd81ad4f7b97af3a3cd13e':
        parser.error('Use the reviewed SVC Bukkit 2.6.27 artifact')
    for port, kind in [(args.proxy_port, socket.SOCK_STREAM), (args.paper_port, socket.SOCK_STREAM), (args.udp_port, socket.SOCK_DGRAM)]:
        with socket.socket(socket.AF_INET, kind) as probe:
            probe.bind(('127.0.0.1', port))
    out.mkdir(parents=True)
    paper = out / 'paper'
    paper.mkdir()
    for name in ['libraries', 'versions', 'cache']:
        shutil.copytree(args.inputs / name, paper / name)
    for name in ['server.jar', 'eula.txt']:
        shutil.copyfile(args.inputs / name, paper / name)
    config = paper / 'plugins/voicechat'
    config.mkdir(parents=True)
    shutil.copyfile(args.svc_jar, paper / 'plugins/voicechat.jar')
    (config / 'voicechat-server.properties').write_text(
        f'port={args.udp_port}\nbind_address=127.0.0.1\nvoice_host=\nmax_voice_distance=48.0\n'
        'allow_recording=false\nallow_pings=true\nforce_voice_chat=false\n')
    (paper / 'server.properties').write_text(
        f'server-ip=127.0.0.1\nserver-port={args.paper_port}\nonline-mode=false\n'
        'enforce-secure-profile=false\nenable-rcon=false\nenable-query=false\n'
        'max-players=5\nview-distance=2\nsimulation-distance=2\nspawn-protection=0\n'
        'level-name=svc-routing-qa\nlevel-type=minecraft:flat\n'
        'generator-settings={"layers":[{"block":"minecraft:bedrock","height":1},{"block":"minecraft:dirt","height":2},{"block":"minecraft:grass_block","height":1}],"biome":"minecraft:plains"}\n'
        'generate-structures=false\nallow-flight=true\n')
    (out / 'inputs.json').write_text(json.dumps({
        'svcSha256': hashlib.sha256(args.svc_jar.read_bytes()).hexdigest(),
        'paperSha256': hashlib.sha256((paper / 'server.jar').read_bytes()).hexdigest(),
        'ports': [args.proxy_port, args.paper_port, args.udp_port],
        'bind': '127.0.0.1', 'copiedWorldsOrAccounts': False}, indent=2))
    paper_process = proxy_process = None
    try:
        paper_log = out / 'paper.log'
        with paper_log.open('w') as log:
            paper_process = subprocess.Popen([args.java, '-Xms256m', '-Xmx768m', '-XX:ActiveProcessorCount=2',
                '-Dterminal.jline=false', '-Dterminal.ansi=false', '-jar', 'server.jar', '--nogui'], cwd=paper,
                stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT, text=True)
        wait_for(paper_process, paper_log, 'Done (')
        wait_for(paper_process, paper_log, 'Voice chat server started')
        print('Isolated Paper/SVC ready; all sockets loopback-only', flush=True)
        for label, compiled in [('baseline', args.baseline_classes), ('candidate', args.classes)]:
            proxy = out / label
            (proxy / 'plugins').mkdir(parents=True)
            (proxy / 'voice-transport-qa.marker').touch()
            (proxy / 'svc-test.properties').write_text(
                f'svc-route.enabled=true\nsvc-route.public-host=127.0.0.1:{args.udp_port}\n'
                f'svc-route.lan-cidr=192.168.3.0/24\nsvc-route.lan-host=localhost:{args.udp_port}\n'
                f'svc-route.loopback-host=127.0.0.1:{args.udp_port}\n')
            (proxy / 'velocity.toml').write_text(
                f'config-version = "2.7"\nbind = "127.0.0.1:{args.proxy_port}"\nonline-mode = false\n'
                'force-key-authentication = false\nplayer-info-forwarding-mode = "none"\n'
                f'[servers]\npaper = "127.0.0.1:{args.paper_port}"\ntry = ["paper"]\n'
                '[forced-hosts]\n"lobby.example.com" = ["paper"]\n"factions.example.com" = ["paper"]\n"minigames.example.com" = ["paper"]\n'
                '[advanced]\nlogin-ratelimit = 0\nhaproxy-protocol = true\n')
            classes = out / (label + '-probe-classes')
            classes.mkdir()
            cp = os.pathsep.join(map(str, [compiled.resolve(), *deps]))
            subprocess.run([args.java, 'com.sun.tools.javac.Main', '-proc:none', '-encoding', 'UTF-8', '-source', '21', '-target', '21',
                '-cp', cp, '-d', str(classes), str(HERE / 'SvcProxyProbe.java')], check=True)
            with zipfile.ZipFile(proxy / 'plugins/SvcProxyProbe.jar', 'w', zipfile.ZIP_DEFLATED) as jar:
                for directory in [compiled, classes]:
                    for file in directory.rglob('*.class'):
                        jar.write(file, file.relative_to(directory).as_posix())
                for dependency in deps[1:]:
                    with zipfile.ZipFile(dependency) as source:
                        for name in source.namelist():
                            if name.endswith('.class') and not name.startswith('META-INF/'):
                                jar.writestr(name, source.read(name))
                jar.writestr('velocity-plugin.json', json.dumps({'id':'svc-protocol-probe','name':'SvcProtocolProbe',
                    'version':'0.0.0-test-only','main':'org.afuhome.auth.SvcProxyProbe'}))
            proxy_log = out / (label + '-proxy.log')
            with proxy_log.open('w') as log:
                proxy_process = subprocess.Popen([args.java, '-Xms128m', '-Xmx256m', '-XX:ActiveProcessorCount=2',
                    '-Dvoice.transport.qa=true', '-Dterminal.jline=false', '-Dterminal.ansi=false', '-jar', str(deps[0])],
                    cwd=proxy, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT, text=True)
            wait_for(proxy_process, proxy_log, 'SVC_QA_READY')
            wait_for(proxy_process, proxy_log, 'Done (')
            result = subprocess.run([args.node, str(HERE / 'live_svc.mjs')], env={**os.environ,
                'VOICE_QA_PORT': str(args.proxy_port), 'VOICE_QA_UDP': str(args.udp_port),
                'VOICE_QA_BASELINE': '1' if label == 'baseline' else '0',
                'VOICE_QA_NODE_PACKAGE': str(args.node_package.resolve())}, capture_output=True, text=True, timeout=75)
            (out / (label + '-client.log')).write_text(result.stdout + result.stderr)
            print(label + ': ' + result.stdout.strip(), flush=True)
            result.check_returncode()
            stop(proxy_process, 'shutdown')
            proxy_process = None
    finally:
        stop(proxy_process, 'shutdown')
        stop(paper_process, 'stop')
    print('PASS native SVC address/UDP/audio lab; no physical Pad microphone/listening acceptance', flush=True)


if __name__ == '__main__':
    main()
