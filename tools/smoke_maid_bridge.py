"""Real isolated NeoForge/TLM smoke; fresh world, fake NPC, no production config or models."""
from __future__ import annotations
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import time
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'world/maid-bridge-src'


def run(args, *, timeout=90, check=True):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding='utf8', errors='replace', timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(result.stderr[-4000:] or result.stdout[-4000:])
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-isolated', action='store_true', required=True)
    parser.add_argument('--companion', action='store_true', help='Verify normal Numen cake adoption and native following instead')
    args = parser.parse_args()
    qa_source = SOURCE / 'qa' / ('CompanionQa.java' if args.companion else 'MaidQa.java')
    qa_mod = 'qiandeng_companion_qa' if args.companion else 'qiandeng_maid_qa'
    build = SOURCE / 'build'
    record = json.loads((build / 'build-record.json').read_text('utf8'))
    jar = build / 'qiandeng-maid-bridge-0.1.0.jar'
    if hashlib.sha256(jar.read_bytes()).hexdigest() != record['sha256']:
        raise ValueError('build_hash_mismatch')
    for name, expected in record['sources'].items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
            raise ValueError('build_sources_changed')
    ident = uuid.uuid4().hex[:12]
    project = 'qiandengji-maid-qa-' + ident
    folder = (ROOT / 'runtime' / ('maid-bridge-qa-' + ident)).resolve()
    if not folder.is_relative_to((ROOT / 'runtime').resolve()) or folder.exists():
        raise ValueError('invalid_qa_directory')
    folder.mkdir()
    print(json.dumps({'stage': 'preparing', 'folder': str(folder), 'project': project}), flush=True)
    data, fake = folder / 'data', folder / 'fake'
    (data / 'mods').mkdir(parents=True); fake.mkdir()
    for mod in (ROOT / 'server/mc/mods').glob('*.jar'):
        if not mod.name.startswith('qiandeng-maid-bridge-'):
            shutil.copyfile(mod, data / 'mods' / mod.name)
    shutil.copyfile(jar, data / 'mods' / jar.name)
    spec = importlib.util.spec_from_file_location('maid_qa_classpath', ROOT / 'world/botgate-src/build.py')
    helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
    embedded = folder / 'numen-api.jar'
    with zipfile.ZipFile(data / 'mods/numen-neoforge-1.21.1-0.1.1.jar') as archive:
        names = [n for n in archive.namelist() if n.startswith('META-INF/jarjar/') and n.endswith('.jar') and 'numen_api' in n]
        if len(names) != 1: raise ValueError('exact_numen_api_required')
        embedded.write_bytes(archive.read(names[0]))
    cp = os.pathsep.join([helper.full_cp(ROOT / 'server/mc/libraries'), str(embedded), *(str(p) for p in (data / 'mods').glob('*.jar'))])
    classes = folder / 'qa-classes'; classes.mkdir()
    javac = Path(os.environ.get('JDK21_BIN', r'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin')) / 'javac.exe'
    quote = lambda text: '"' + str(text).replace('\\', '/') + '"'
    (folder / 'javac.args').write_text('\n'.join(['-proc:none', '--release', '21', '-encoding', 'UTF-8', '-cp', quote(cp),
        '-d', quote(classes), quote(qa_source)]), encoding='utf8')
    run([str(javac), '@' + str(folder / 'javac.args')])
    with zipfile.ZipFile(data / 'mods/qiandeng-maid-qa.jar', 'w', zipfile.ZIP_DEFLATED) as output:
        for entry in classes.rglob('*.class'):
            output.write(entry, entry.relative_to(classes).as_posix())
        output.writestr('META-INF/neoforge.mods.toml', 'modLoader="javafml"\nloaderVersion="[4,)"\nlicense="MIT"\n[[mods]]\nmodId="' + qa_mod + '"\nversion="0.0.1"\ndisplayName="Isolated QA fixture"\n')
    key = secrets.token_hex(32)
    (data / 'config/qiandeng_maid_bridge').mkdir(parents=True)
    (data / 'config/qiandeng_maid_bridge/identity.key').write_text(key, 'ascii')
    (fake / 'identity.key').write_text(key, 'ascii')
    sites = data / 'config/touhou_little_maid/sites'; sites.mkdir(parents=True)
    (sites / 'llm.json').write_text(json.dumps({name: {'id': name, 'api_type': 'qiandeng-qwen',
        'enabled': not (args.companion and name == 'deepseek'), 'icon': 'touhou_little_maid:textures/gui/ai_chat/openai.png',
        'url': 'http://npc:8091/v1/maid/chat/completions', 'secret_key': '', 'headers': {},
        'models': ['qd-maid-dialogue']} for name in ('codingplan', 'deepseek')}), 'utf8')
    (sites / 'tts.json').write_text('{}', 'utf8')
    password = secrets.token_hex(16)
    (data / 'eula.txt').write_text('eula=true\n', 'ascii')
    (data / 'server.properties').write_text('\n'.join(['level-name=qa-world', 'level-type=minecraft:flat',
        'online-mode=false', 'enforce-secure-profile=false', 'server-port=25565', 'enable-rcon=true',
        'rcon.port=25575', 'rcon.password=' + password, 'view-distance=2', 'simulation-distance=2',
        'difficulty=peaceful', 'spawn-protection=0', 'max-tick-time=120000', 'sync-chunk-writes=false',
        'allow-flight=true', 'motd=Isolated maid bridge QA', '']) , 'ascii')
    (fake / 'server.py').write_text('''import hashlib,hmac,json,threading,time
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
lock=threading.Lock()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_POST(self):
  raw=self.rfile.read(min(int(self.headers.get('Content-Length','0')),65537))
  key=Path('/fake/identity.key').read_text().strip().encode()
  signed=self.headers.get('X-QD-Request-Id','')+'\\n'+self.headers.get('X-QD-Issued-At','')+'\\n'+hashlib.sha256(raw).hexdigest()
  valid=self.path=='/v1/maid/chat/completions' and hmac.compare_digest(hmac.new(key,signed.encode(),hashlib.sha256).hexdigest(),self.headers.get('X-QD-Signature',''))
  obj=json.loads(raw); identity=obj['qd_identity']
  marker='QA_REPLY_'+identity['maidUuid']
  with lock:
   with Path('/fake/requests.jsonl').open('a') as stream: stream.write(json.dumps({'validSignature':valid,'identity':identity,'toolsAbsent':'tools' not in obj,'path':self.path,'response':marker})+'\\n')
  body=json.dumps({'choices':[{'message':{'role':'assistant','content':marker}}]}).encode()
  self.send_response(200 if valid else 403);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
ThreadingHTTPServer(('0.0.0.0',8091),Handler).serve_forever()
''', 'utf8')
    mc_image = run(['docker', 'image', 'inspect', 'itzg/minecraft-server:java21', '--format', '{{.Id}}']).stdout.strip()
    py_image = run(['docker', 'image', 'inspect', 'qiandengji-survivor:2.2.0-qd5', '--format', '{{.Id}}']).stdout.strip()
    compose = {'services': {
        'npc': {'image': py_image, 'entrypoint': ['python', '/fake/server.py'], 'volumes': [f'{fake.as_posix()}:/fake'], 'networks': ['qa']},
        'mc': {'image': mc_image, 'entrypoint': ['java', '-Xms1G', '-Xmx3G', '@libraries/net/neoforged/neoforge/21.1.248/unix_args.txt', 'nogui'],
            'working_dir': '/data', 'environment': {'QD_QA_FIXTURE': 'isolated-maid-bridge', 'RCON_PASSWORD': password},
            'volumes': [f'{data.as_posix()}:/data', f'{(ROOT / "server/mc/libraries").as_posix()}:/data/libraries:ro'],
            'networks': ['qa'], 'depends_on': ['npc'], 'stop_grace_period': '60s'}}, 'networks': {'qa': {'internal': True}}}
    compose_path = folder / 'compose.json'; compose_path.write_text(json.dumps(compose), 'utf8')
    base = ['docker', 'compose', '-p', project, '-f', str(compose_path)]
    checks = {}; details = {}
    def command(value):
        return run([*base, 'exec', '-T', 'mc', 'rcon-cli', value], timeout=45).stdout
    def response(value, prefix='QD_MAID_JSON '):
        text = command(value)
        if prefix not in text: raise ValueError('unexpected_rcon_reply: ' + text[-500:])
        return json.JSONDecoder().raw_decode(text.split(prefix, 1)[1])[0]
    def invoke(maid, op, args=None, request_id=None, owner=None):
        payload = {'schema': 1, 'requestId': request_id or uuid.uuid4().hex, 'maidUuid': maid['maidUuid'],
            'ownerUuid': owner or maid['ownerUuid'], 'operation': op, 'args': args or {}}
        encoded = base64.urlsafe_b64encode(json.dumps(payload, separators=(',', ':')).encode()).decode().rstrip('=')
        return response('qdmaid invoke ' + encoded)
    try:
        run([*base, 'up', '-d'], timeout=180)
        deadline = time.monotonic() + 420
        while time.monotonic() < deadline:
            logs = run([*base, 'logs', '--no-color', 'mc'], check=False).stdout
            (folder / 'server-boot.log').write_text(logs, 'utf8')
            if 'Done (' in logs: break
            state = run([*base, 'ps', '-a', '--format', 'json'], check=False).stdout
            if 'exited' in state.lower(): raise RuntimeError('isolated_mc_exited')
            time.sleep(5)
        else: raise RuntimeError('isolated_mc_start_timeout')
        print(json.dumps({'stage': 'server_ready'}), flush=True)
        checks['real-neoforge-start'] = True
        if args.companion:
            from smoke_maid_companion_checks import check_companion
            check_companion(response=response, command=command, invoke=invoke, run=run,
                base=base, data=data, fake=fake, checks=checks, details=details)
        else:
            setup = response('qdmaidqa setup', 'QD_MAID_QA '); maids = setup['maids']; details['setup'] = setup
            checks['two-owned-isolated-bodies'] = len(maids) == 2 and all(m['ownerOnline'] for m in maids)
            checks['native-deepseek-site-codec'] = all(m['siteId'] == 'deepseek' and m['siteClass'] == 'dev.qiandeng.maid.BridgeSite' for m in maids)
            checks['native-persona-fixture'] = all(m['nativeSetting'] for m in maids)
            listed = response('qdmaid list 0'); details['list'] = listed
            checks['loaded-identity-discovery'] = {m['maidUuid'] for m in listed['maids']} == {m['maidUuid'] for m in maids}
            observed = [invoke(m, 'identity') for m in maids]; details['identities'] = observed
            checks['native-identity'] = all(r['ok'] and r['identity']['ownerUuid'] == m['ownerUuid'] for r, m in zip(observed, maids))
            checks['native-persona-diagnostic'] = all(r['state'].get('nativeChatSetting') is True for r in observed) and all(m.get('nativeChatSetting') is True for m in listed['maids'])
            context = invoke(maids[0], 'context', {'category': observed[0]['contextCategories'][0]}); details['context'] = context
            checks['native-context'] = context['ok'] and isinstance(context['lines'], list) and context['trustedInstructions'] is False
            catalog = invoke(maids[0], 'task_catalog'); details['catalog'] = catalog
            checks['native-task-catalog'] = catalog['ok'] and len(catalog['tasks']) > 0
            denied = invoke(maids[0], 'sit', {'sit': True}, owner=maids[1]['ownerUuid']); details['crossOwner'] = denied
            checks['cross-owner-rejected'] = denied['ok'] is False and denied['code'] == 'owner_changed'
            request_id = uuid.uuid4().hex
            applied = invoke(maids[0], 'sit', {'sit': True}, request_id)
            restored = invoke(maids[0], 'sit', {'sit': False})
            replay = invoke(maids[0], 'sit', {'sit': True}, request_id)
            final = invoke(maids[0], 'identity')
            details['sit'] = {'applied': applied, 'restored': restored, 'replay': replay, 'final': final}
            checks['native-state-switch-and-restore'] = applied['ok'] and applied['after']['sitting'] and restored['ok'] and not restored['after']['sitting']
            checks['durable-idempotence-no-reapply'] = replay.get('replayedReceipt') is True and not final['state']['sitting']
            conflict = invoke(maids[0], 'sit', {'sit': False}, request_id); details['conflict'] = conflict
            checks['request-id-conflict'] = conflict['code'] == 'request_id_conflict'
            before = final['state']
            changes = {}
            for op, args, restore in (
                ('follow', {'follow': not before['following']}, {'follow': before['following']}),
                ('schedule', {'schedule': 'NIGHT' if before['schedule'] != 'NIGHT' else 'DAY'}, {'schedule': before['schedule']}),
                ('work', {'taskId': before['taskId']}, {'taskId': before['taskId']}),
            ):
                changes[op] = {'applied': invoke(maids[0], op, args), 'restored': invoke(maids[0], op, restore)}
            details['otherNativeStates'] = changes
            checks['native-follow-schedule-work'] = all(v['applied']['ok'] and v['restored']['ok'] and v['applied']['workCompleted'] is False for v in changes.values())
            details['chatSubmit'] = response('qdmaidqa chat', 'QD_MAID_QA ')
            deadline = time.monotonic() + 80
            while time.monotonic() < deadline:
                status = response('qdmaidqa status', 'QD_MAID_QA ')
                if all(any('QA_REPLY_' in text for text in m['assistantHistory']) for m in status['maids']): break
                time.sleep(2)
            details['chatStatus'] = status
            requests = [json.loads(line) for line in (fake / 'requests.jsonl').read_text('utf8').splitlines()] if (fake / 'requests.jsonl').exists() else []
            details['signedRequestCount'] = len(requests)
            checks['real-native-chat-callback'] = len(requests) == 2 and all(any('QA_REPLY_' + m['maidUuid'] in text for text in m['assistantHistory']) for m in status['maids'])
            checks['signed-two-identity-isolation'] = len(requests) == 2 and all(r['validSignature'] and r['toolsAbsent'] for r in requests) and {r['identity']['maidUuid'] for r in requests} == {m['maidUuid'] for m in maids}
            command('save-all flush')
            checks['isolated-save-written'] = (data / 'qa-world/level.dat').exists()
            run([*base, 'stop', '-t', '60', 'mc'], timeout=100)
            run([*base, 'start', 'mc'], timeout=60)
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                try:
                    after_restart = invoke(maids[0], 'identity')
                    if after_restart.get('ok'): break
                except (RuntimeError, ValueError): pass
                time.sleep(5)
            else: raise RuntimeError('isolated_restart_identity_timeout')
            details['afterRestart'] = after_restart
            checks['save-restart-identity-preserved'] = after_restart['identity']['maidUuid'] == maids[0]['maidUuid'] and after_restart['identity']['ownerUuid'] == maids[0]['ownerUuid']
            restart_replay = invoke(maids[0], 'sit', {'sit': True}, request_id)
            still_restored = invoke(maids[0], 'identity')
            checks['save-restart-idempotence-preserved'] = restart_replay.get('replayedReceipt') is True and not still_restored['state']['sitting']
    except Exception as error:
        details['failure'] = str(error)[:4000]
        checks['execution-completed'] = False
    finally:
        (folder / 'server-final.log').write_text(run([*base, 'logs', '--no-color'], check=False).stdout, 'utf8')
        teardown = run([*base, 'down', '--timeout', '60'], timeout=120, check=False)
        checks['isolated-services-removed'] = teardown.returncode == 0 and not run([*base, 'ps', '-a', '-q'], check=False).stdout.strip()
    report = {'ok': all(checks.values()), 'checks': checks, 'details': details, 'jarSha256': record['sha256'],
        'project': project, 'folder': str(folder), 'modelCalls': 0, 'ttsCalls': 0, 'productionMutations': 0,
        'liveAcceptanceScope': 'fresh isolated world, actual installed mods and native callbacks, deterministic fake NPC; no physical client or audio',
        'fixtureSha256': hashlib.sha256(qa_source.read_bytes()).hexdigest(),
        'toolSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    (folder / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', 'utf8')
    print(json.dumps({'ok': report['ok'], 'checks': checks, 'report': str(folder / 'result.json')}), flush=True)
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
