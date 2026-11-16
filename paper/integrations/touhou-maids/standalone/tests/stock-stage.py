"""Exercise two authorized maids on stock NeoForge using synthetic people and services."""
from __future__ import annotations

import argparse
import asyncio
from contextlib import contextmanager
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import struct
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import wave

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT.parent / 'harness')]
from build import classpath, compile_java, write_zip
from dsh_gateway import create_server

IDS = ['10000000-0000-0000-0000-00000000000' + str(i) for i in (1, 2)]
OWNERS = ['20000000-0000-0000-0000-00000000000' + str(i) for i in (1, 2)]
ML = ['fixture-a', 'fixture-b']


def data(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def ports():
    sockets = [socket.socket() for _ in range(3)]
    try:
        for entry in sockets:
            entry.bind(('127.0.0.1', 0))
        return [entry.getsockname()[1] for entry in sockets]
    finally:
        for entry in sockets:
            entry.close()


def make_probe(phase, stage, java, maid):
    classes = phase / 'probe-classes'
    cp = os.pathsep.join(str(path) for path in classpath(stage, maid))
    compile_java(java.with_name('javac' + java.suffix),
                 ['--release', '21', '-encoding', 'UTF-8', '-proc:none', '-classpath', cp,
                  '-d', classes, Path(__file__).with_name('MaidAgentsProbe.java')], phase / 'probe.args')
    entries = {path.relative_to(classes).as_posix(): path.read_bytes() for path in classes.rglob('*.class')}
    entries['META-INF/neoforge.mods.toml'] = b'''modLoader="javafml"
loaderVersion="[4,)"
license="MIT"
[[mods]]
modId="tlm_maid_agents_test"
version="1.0.0"
displayName="TLM Maid Agents stock test fixture"
'''
    write_zip(stage / 'mods/tlm-maid-agents-test.jar', entries)


def stock_sites(stage, gateway_url, tts_url, tokens):
    rows, maids = {}, []
    for i, (letter, maid, owner, model, token) in enumerate(zip('ab', IDS, OWNERS, ML, tokens, strict=True)):
        choices = {}
        for name in ('dsh', 'native') if i == 0 else ('dsh',):
            alias = f'maidagent_{letter}_{name}'
            # The alternate fixture site uses the same planner to test the server-side selection.
            rows[alias] = {'id': alias, 'api_type': 'openai', 'enabled': True,
                           'icon': 'touhou_little_maid:textures/gui/ai_chat/openai.png',
                           'url': f'{gateway_url}/v1/{maid}/{name}/chat/completions',
                           'secret_key': token, 'headers': {}, 'models': [model]}
            choices[name] = {'site': alias, 'model': model}
        maids.append({'maidId': maid, 'ownerId': owner, 'choices': choices,
                      'voice': {'site': f'fixture-voice-{letter}', 'model': f'fixture-{letter}', 'language': 'zh_cn'}})
        if letter == 'b':
            maids[-1]['visitorPersona'] = 'A synthetic blacksmith in the fixture village.'
    data(stage / 'config/tlm-maid-agents.json', {'schema': 1, 'maids': maids})
    data(stage / 'config/touhou_little_maid/sites/llm.json', rows)
    tts = {}
    for letter in 'ab':
        alias = f'fixture-voice-{letter}'
        tts[alias] = {'id': alias, 'api_type': 'gpt-sovits', 'enabled': True,
                      'icon': 'touhou_little_maid:textures/gui/ai_chat/siliconflow.png',
                      'url': f'{tts_url}/tts/{letter}', 'secret_key': '', 'headers': {},
                      'ref_audio_path': 'fixture.wav', 'prompt_text': 'fixture', 'prompt_lang': 'zh',
                      'aux_ref_audio_paths': [], 'text_split_method': 'cut1'}
    data(stage / 'config/touhou_little_maid/sites/tts.json', tts)


def rcon(port, password, command):
    def read_bytes(connection, count):
        out = bytearray()
        while len(out) < count:
            packet = connection.recv(count - len(out))
            if not packet:
                raise OSError('RCON closed')
            out.extend(packet)
        return bytes(out)

    def send(connection, request, kind, value):
        payload = struct.pack('<ii', request, kind) + value.encode() + b'\0\0'
        connection.sendall(struct.pack('<i', len(payload)) + payload)
        length = struct.unpack('<i', read_bytes(connection, 4))[0]
        response = read_bytes(connection, length)
        if struct.unpack_from('<i', response)[0] != request:
            raise AssertionError('RCON response ID mismatch')
        return response[8:-2].decode()

    with socket.create_connection(('127.0.0.1', port), timeout=5) as connection:
        send(connection, 1, 3, password)
        return send(connection, 2, 2, command)


def until(predicate, timeout):
    last = None
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            last = predicate()
            if last:
                return last
        except OSError:
            pass
        time.sleep(.25)
    raise AssertionError('Timed out waiting for the stock server evidence')


@contextmanager
def serving(server):
    with server:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            yield server
        finally:
            server.shutdown()
            worker.join()


def scenario(args):
    stage = args.server.resolve()
    if (stage / '.standalone-maid-agents-lab').read_text().strip() != 'SYNTHETIC_STOCK_NEOFORGE':
        raise ValueError('Use a marked isolated NeoForge test installation')
    installation = list(stage.glob('libraries/net/neoforged/neoforge/21.1.*/win_args.txt'))
    if len(installation) != 1:
        raise ValueError('Expected a stock Windows NeoForge 21.1 runtime')
    digest = hashlib.sha256(args.maid.read_bytes()).hexdigest()
    if digest != 'f6db04195820c8508704277ea76d63723804ff236a7b780369ba59ebe5cd9c27':
        raise ValueError('Expected the unmodified official NeoForge TLM 1.5.3 jar')
    run_id = secrets.token_hex(4)
    phase = stage / f'exercise-{run_id}'
    phase.mkdir()
    (stage / 'mods').mkdir(exist_ok=True)
    shutil.copyfile(args.maid, stage / 'mods' / args.maid.name)
    shutil.copyfile(args.addon, stage / 'mods/tlm-maid-agents.jar')
    make_probe(phase, stage, args.java, args.maid)
    game_port, rcon_port, gateway_port = ports()
    password = secrets.token_hex(20)
    (stage / 'server.properties').write_text(
        f'server-ip=127.0.0.1\nserver-port={game_port}\nenable-rcon=true\nrcon.port={rcon_port}\nrcon.password={password}\n'
        f'level-name=synthetic-maids-{run_id}\nlevel-type=minecraft:flat\ngamemode=creative\nspawn-protection=0\n'
        'difficulty=peaceful\nview-distance=3\nsimulation-distance=3\nmax-players=2\nonline-mode=false\n'
        'generator-settings={"layers":[{"block":"minecraft:bedrock","height":1},{"block":"minecraft:dirt","height":2},'
        '{"block":"minecraft:grass_block","height":1}],"biome":"minecraft:plains"}\n'
    )
    (stage / 'eula.txt').write_text('eula=true\n')
    tokens = [secrets.token_hex(24), secrets.token_hex(24)]
    dsh = {'schema': 1, 'host': '127.0.0.1', 'port': gateway_port,
           'maxConcurrent': 4, 'maids': [
               {'maidId': maid, 'ownerId': owner, 'token': token, 'choices': {
                   name: {'harness_id': name, 'model': model}
                   for name in (('dsh', 'native') if i == 0 else ('dsh',))}}
               for i, (maid, owner, model, token) in enumerate(zip(IDS, OWNERS, ML, tokens, strict=True))]}
    calls, speech, checks = [], [], []
    responses, submission_keys = {}, set()
    late_arrived, late_release = threading.Event(), threading.Event()

    def record(name, value=True, detail=None):
        assert value, f'{name} failed: {detail}'
        checks.append(name)
        print(name, flush=True)

    async def plan(choice, messages, tools):
        letter = choice['model'][-1]
        latest = [row['content'] for row in messages if row['role'] == 'user'][-1].rsplit('\n', 1)[-1]
        returned = [row['content'] for row in messages if row['role'] == 'tool']
        calls.append((letter, latest, messages, tools))
        if latest == 'A-late-only':
            late_arrived.set()
            await asyncio.to_thread(late_release.wait, 15)
            name, arguments = 'switch_sit', {'sit': False}
        elif (latest == 'A-first' or latest == 'B-first') and not returned:
            if letter == 'a':
                name, arguments = 'equip_from_backpack', {
                    'equipment_slot': 'mainhand', 'backpack_slot': 0, 'expected_item': 'minecraft:iron_sword'}
            else:
                name, arguments = 'switch_sit', {'sit': True}
        else:
            return {'content': f'{letter}-reply-{latest}---{letter}-voice-{latest}'}
        call_id = 'native_late' if latest == 'A-late-only' else 'native_' + letter
        return {'tool_calls': [{'id': call_id, 'type': 'function',
                                'function': {'name': name, 'arguments': json.dumps(arguments)}}]}

    class Hub(BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path.endswith('/cancel'):
                self.send_value({'status': 'cancelled'})
                return
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            marker = self.headers.get('Idempotency-Key')
            assert marker and marker not in submission_keys and body['background'] is True
            assert body['metadata']['harness_id'] in ('dsh', 'native')
            submission_keys.add(marker)
            key = 'resp_' + secrets.token_hex(12)
            responses[key] = body
            self.send_value({'id': key, 'status': 'running'})

        def do_GET(self):
            key = self.path.rsplit('/', 1)[-1]
            body = responses[key]
            conversation = json.loads(body['input'])
            result = asyncio.run(plan({'model': body['model']}, conversation['messages'], conversation['tools']))
            self.send_value({'id': key, 'status': 'completed', 'model': body['model'],
                             'output': [{'type': 'message', 'role': 'assistant',
                                         'content': [{'type': 'output_text', 'text': json.dumps(result)}]}]})

        def send_value(self, value):
            raw = json.dumps(value).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def log_message(self, *args):
            pass

    class Tts(BaseHTTPRequestHandler):
        def do_POST(self):
            raw = self.rfile.read(int(self.headers.get('Content-Length', '0')))
            self.answer(raw.decode())

        def do_GET(self):
            self.answer(urlsplit(self.path).query)

        def answer(self, payload):
            speech.append((urlsplit(self.path).path, payload))
            buf = io.BytesIO()
            with wave.open(buf, 'wb') as audio:
                audio.setparams((1, 2, 24000, 0, 'NONE', 'PCM'))
                audio.writeframes(struct.pack('<h', 1000) * 2400)
            content = buf.getvalue()
            self.send_response(200)
            self.send_header('Content-Type', 'audio/wav')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        def log_message(self, *args):
            pass

    def run(command):
        return rcon(rcon_port, password, command)

    key_file = phase / 'fixture-hub-key.json'
    data(key_file, {'key': secrets.token_hex(24)})
    hub = ThreadingHTTPServer(('127.0.0.1', 0), Hub)
    dsh['hub'] = {'base_url': f'http://127.0.0.1:{hub.server_port}', 'keyFile': str(key_file)}
    with serving(hub), serving(create_server(dsh)), serving(ThreadingHTTPServer(('127.0.0.1', 0), Tts)) as tts:
        wrong_bearer = Request(f'http://127.0.0.1:{gateway_port}/v1/{IDS[1]}/dsh/chat/completions',
                               data=b'{}', headers={'Authorization': 'Bearer ' + tokens[0]})
        try:
            with urlopen(wrong_bearer, timeout=3):
                raise AssertionError('Cross-tenant credentials were accepted')
        except HTTPError as refused:
            record('shared gateway rejects token from a different maid before planning', refused.code == 401 and not calls)
        stock_sites(stage, f'http://127.0.0.1:{gateway_port}', f'http://127.0.0.1:{tts.server_port}', tokens)
        for restarting in (False, True):
            suffix = 'restart' if restarting else 'first'
            marker = phase / f'{suffix}.log'
            with marker.open('wb') as log:
                server = subprocess.Popen([str(args.java), '-Xms512m', '-Xmx1400m', '-XX:ActiveProcessorCount=4',
                                           '@' + installation[0].relative_to(stage).as_posix(), 'nogui'],
                                          cwd=stage, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                          creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                try:
                    def ready():
                        if server.poll() is not None:
                            raise AssertionError(f'NeoForge exited; read {marker}')
                        return 'players online' in run('list')
                    until(ready, 150)
                    until(lambda: 'registered 2 fixed entity bindings' in marker.read_text(encoding='utf-8', errors='replace'), 15)
                    a, b = IDS
                    if restarting:
                        state = run('maidagenttest check')
                        record('cold restart retained both brains, histories, voices and equipment',
                               'A site=maidagent_a_dsh voice=fixture-a' in state and
                               'B site=maidagent_b_dsh voice=fixture-b' in state and
                               'a-reply-A-first' in state and 'b-reply-B-second-only' in state and 'iron_sword' in state,
                               state)
                        continue
                    record('original TLM and add-on loaded on clean NeoForge')
                    record('two original entity bindings seeded', 'seeded' in run('maidagenttest seed'))
                    record('owner sees only own maid', a in (mine := run('maidagenttest as-a maidagent list')) and b not in mine, mine)
                    record('owner cannot mutate another maid', 'unavailable to you' in run(f'maidagenttest as-a maidagent mode {b} stay'))
                    record('DSH selection A', 'brain=dsh' in run(f'maidagenttest as-a maidagent brain {a} dsh'))
                    record('DSH selection B', 'brain=dsh' in run(f'maidagent brain {b} dsh'))
                    record('native TTS choices', all(f'nativeTts=fixture-{s}' in run(f'maidagent voice {maid}')
                                                    for s, maid in zip('ab', IDS, strict=True)))
                    record('unbound maid cannot borrow shared DSH credentials',
                           'unboundCode=403' in run('maidagenttest unbound') and not calls)
                    record('gear command rejects incompatible armor', 'does not fit' in run(f'maidagent equip {b} feet 0'))
                    record('gear command swaps actual armor', 'head=minecraft:golden_helmet' in run(f'maidagent equip {b} head 0'))
                    record('native task selector accepts registered idle', 'selectedTask=touhou_little_maid:idle' in
                           run(f'maidagent task {a} touhou_little_maid:idle'))
                    record('available task catalog comes from the active entity',
                           'touhou_little_maid:idle' in run(f'maidagent tasks {a}'))
                    record('first paired native chat submitted', 'submitted first' in run('maidagenttest chat first'))
                    try:
                        paired = until(lambda: (state if 'a-reply-A-first' in (state := run('maidagenttest check')) and
                                                'b-reply-B-first' in state else None), 25)
                    except AssertionError as failure:
                        trace = [(letter, signal, [row['role'] for row in messages]) for letter, signal, messages, _ in calls]
                        raise AssertionError(f'Paired dialogue did not finish: {trace}; {run("maidagenttest check")}') from failure
                    record('DSH switched a native mode and equipped actual observed sword',
                           'A site=maidagent_a_dsh voice=fixture-a sit=false main=minecraft:iron_sword' in paired and
                           'B site=maidagent_b_dsh voice=fixture-b sit=true' in paired, paired)
                    receipts = [(l, m.get('tool_call_id'), m.get('content')) for l, _, messages, _ in calls
                                for m in messages if m['role'] == 'tool']
                    record('native continuations contain only the originating maid receipts',
                           any(l == 'a' and 'Equipped minecraft:iron_sword' in str(reply) for l, _, reply in receipts) and
                           any(l == 'b' and bool(reply) for l, _, reply in receipts) and
                           all(key == f'native_{l}' for l, key, _ in receipts), receipts)
                    record('both original TLM TTS routes received their own reply',
                           until(lambda: all(any(path == f'/tts/{l}' and f'{l}-voice-' in payload for path, payload in speech)
                                             for l in 'ab'), 15))
                    record('dialogue histories isolated in the native model input',
                           all(not any(other in str(row.get('content')) for row in messages)
                               for l, _, messages, _ in calls for other in [f'{"B" if l == "a" else "A"}-first']))
                    record('stay was applied before requesting a conflicting action',
                           'mode=stay' in run(f'maidagent mode {a} stay'))
                    run('maidagenttest chat late-only')
                    record('late old DSH request captured', late_arrived.wait(8))
                    record('authorized switch with an older request pending', 'brain=native' in run(f'maidagent brain {a} native'))
                    run('maidagenttest chat second-only')
                    record('second maid can complete while the first route is waiting',
                           until(lambda: 'b-reply-B-second-only' in run('maidagenttest check'), 10))
                    late_release.set()
                    time.sleep(1)
                    stale = run(f'maidagent status {a}')
                    record('old DSH response cannot stand the other selection back up',
                           'mode=stay' in stale and not any(row.get('tool_call_id') == 'native_late'
                                                          for _, _, messages, _ in calls for row in messages), stale)
                    record('native brain can return to DSH', 'brain=dsh' in run(f'maidagent brain {a} dsh'))
                    record('visitor finds only the explicitly public NPC',
                           b in (near := run('maidagenttest as-a maidagent nearby')) and a not in near, near)
                    record('nearby visitor can speak to a different owner NPC',
                           'received your message' in run(f'maidagenttest as-a maidagent say {b} B-guest'))
                    record('visitor gets a separate native voice reply',
                           until(lambda: any(path == '/tts/b' and 'b-voice-B-guest' in payload for path, payload in speech), 12))
                    guest = next((messages, tools) for _, latest, messages, tools in calls if latest == 'B-guest')
                    record('visitor dialogue has no owner history, physical state or tools',
                           len(guest[0]) == 2 and not guest[1] and not any(
                               phrase in str(guest[0]) for phrase in ('B-first', 'physical state', 'golden_helmet')) and
                           'B-guest' not in run('maidagenttest check'), guest)
                    record('each original model request was submitted once with a distinct UHP key',
                           len(submission_keys) == len(calls))
                finally:
                    late_release.set()
                    if server.poll() is None:
                        try:
                            run('stop')
                            server.wait(timeout=45)
                        except (OSError, subprocess.TimeoutExpired):
                            # Only the subprocess started by this isolated synthetic fixture.
                            server.terminate()
                            server.wait(timeout=10)
    report = {'minecraft': '1.21.1', 'tlmSha256': digest, 'addonSha256': hashlib.sha256(args.addon.read_bytes()).hexdigest(),
              'run': phase.name, 'checks': checks, 'modelCalls': len(calls), 'nativeTtsRequests': len(speech)}
    data(args.report, report)
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('server', 'maid', 'java', 'addon', 'report'):
        parser.add_argument('--' + name, required=True, type=Path)
    scenario(parser.parse_args())
