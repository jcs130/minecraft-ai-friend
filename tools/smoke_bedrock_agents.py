"""Load native companion forms in the pinned real Geyser, on isolated loopback ports."""
from __future__ import annotations
import argparse
import json
import shutil
import socket
import subprocess
import threading
import time
from pathlib import Path
from build_bedrock_agents import NAME
from maw_bedrock_service import bedrock_probe, geyser_config
from society_lab import DEFAULT_JAVA, DEFAULT_ROOT


def run(root: Path, output: Path):
    output = output.resolve()
    if output.exists() or (root/'research').resolve() not in output.parents:
        raise ValueError('Use a new evidence directory inside runtime/research')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 28992))
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.bind(('127.0.0.1', 28993))
    resources = output/'plugins/Geyser'
    extensions = resources/'extensions'
    extensions.mkdir(parents=True)
    shutil.copyfile(root/'bedrock/ViaProxy-3.4.14.jar', output/'ViaProxy.jar')
    shutil.copyfile(root/'bedrock/plugins/Geyser-ViaProxy.jar', output/'plugins/Geyser-ViaProxy.jar')
    shutil.copyfile(root/'build/bedrock-agents'/NAME, extensions/NAME)
    (resources/'config.yml').write_text(geyser_config('127.0.0.1').replace('port: 28988', 'port: 28993'), encoding='utf-8')
    # No real session uses this QA bridge credential and no model is configured.
    (resources/'maw-agents-private.json').write_text(json.dumps({'endpoint':'http://127.0.0.1:28990/ui', 'secret':'a'*64}), encoding='utf-8')
    process = subprocess.Popen([str(DEFAULT_JAVA), '-Djava.net.preferIPv4Stack=true', '-Xms128M', '-Xmx512M',
        '-jar', str(output/'ViaProxy.jar'), 'cli', '--target-address', '127.0.0.1:28994',
        '--target-version', '1.21.1', '--auth-method', 'NONE', '--bind-address', '127.0.0.1:28992',
        '--wildcard-domain-handling', 'NONE'], cwd=output, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace',
        creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    ready = threading.Event()
    lines = []
    def capture():
        with (output/'geyser.log').open('w', encoding='utf-8') as stream:
            for line in process.stdout:
                lines.append(line); stream.write(line); stream.flush()
                if 'MAW_AGENTS ready nativeForms=true modelKeysRedacted=true' in line:
                    ready.set()
    reader = threading.Thread(target=capture, daemon=True); reader.start()
    report = {'schemaVersion':1, 'checks':{}, 'paidModelRequests':0, 'worldActions':0,
        'actualPhoneTested':False, 'ok':False}
    try:
        deadline = time.monotonic()+90
        while not ready.is_set() and process.poll() is None and time.monotonic()<deadline:
            time.sleep(.2)
        report['checks']['real_geyser_extension_and_command_registered'] = ready.is_set()
        report['checks']['real_native_maid_command_registered'] = any('MAW_MAID_FORMS ready nativeConfig=true permission=native_operator ownerOnly=true' in line for line in lines)
        report['checks']['real_visual_interaction_registered'] = any('MAW_VISUAL_MENUS ready welcomeButtons=true ownEntityClick=true controls=true privateEvents=true' in line for line in lines)
        if ready.is_set():
            for _ in range(20):
                try:
                    report['pong'] = bedrock_probe('127.0.0.1',28993)
                    break
                except (OSError,ValueError):
                    time.sleep(.25)
            report['checks']['isolated_bedrock_raknet'] = 'pong' in report
        report['checks']['no_extension_load_error'] = not any(
            'MawAgents' in line and ('Exception' in line or 'Failed' in line) for line in lines)
    finally:
        if process.poll() is None:
            process.stdin.write('stop\n'); process.stdin.flush(); process.wait(timeout=45)
        reader.join(timeout=5)
        report['exitCode'] = process.returncode
        report['ok'] = len(report['checks'])==5 and all(report['checks'].values()) and process.returncode==0
        (output/'acceptance.json').write_text(json.dumps(report,ensure_ascii=False,indent=2), encoding='utf-8')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=DEFAULT_ROOT)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args(); result=run(args.root,args.output)
    print(json.dumps(result,ensure_ascii=False));raise SystemExit(0 if result['ok'] else 1)
