"""Exercise say against an isolated NeoForge world; never connect to production."""
from pathlib import Path
from types import SimpleNamespace
import importlib.util
import json
import os
import secrets
import subprocess
import sys
import time
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from chat import ChatTools
from mcp_server import SkillTools
from numen_gateway import write_json


def run(command, timeout=90):
    result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8',
                            errors='replace', timeout=timeout,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError(result.stderr[-1800:] or result.stdout[-1800:])
    return result.stdout.strip()


def main():
    identity = uuid.uuid4().hex[:10]
    folder = ROOT / 'runtime' / ('survivor-chat-qa-' + identity)
    data, classes = folder / 'data', folder / 'classes'
    (data / 'mods').mkdir(parents=True)
    classes.mkdir()
    helper_spec = importlib.util.spec_from_file_location('chat_qa_build', ROOT / 'world/botgate-src/build.py')
    helper = importlib.util.module_from_spec(helper_spec)
    helper_spec.loader.exec_module(helper)
    quote = lambda p: '"' + str(p).replace('\\', '/') + '"'
    args = folder / 'javac.args'
    args.write_text('\n'.join(['-proc:none', '--release', '21', '-encoding', 'UTF-8', '-cp',
        quote(helper.full_cp(ROOT / 'server/mc/libraries')), '-d', quote(classes),
        quote(ROOT / 'world/survival/tests/PublicChatQa.java'),
        quote(ROOT / 'world/botgate-src/tests/RconConcurrentClient.java')]), 'utf-8')
    run([helper.JAVAC, '@' + str(args)])
    with zipfile.ZipFile(data / 'mods/chat-qa.jar', 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in classes.rglob('*.class'):
            archive.write(path, path.relative_to(classes).as_posix())
        archive.writestr('META-INF/neoforge.mods.toml', 'modLoader="javafml"\nloaderVersion="[4,)"\nlicense="MIT"\n[[mods]]\nmodId="qiandeng_chat_qa"\nversion="0.0.1"\ndisplayName="Isolated public chat QA"\n')
    password = secrets.token_hex(20)
    (data / 'eula.txt').write_text('eula=true\n', 'ascii')
    (data / 'server.properties').write_text('\n'.join(['level-name=qa-world', 'level-type=minecraft:flat',
        'online-mode=false', 'enforce-secure-profile=false', 'enable-rcon=true', 'rcon.port=25575',
        'rcon.password=' + password, 'view-distance=2', 'simulation-distance=2', 'difficulty=peaceful',
        'spawn-protection=0', 'max-tick-time=120000', '']), 'ascii')
    name = 'qiandeng-chat-qa-' + identity
    def command(text):
        cp = '/data/mods/chat-qa.jar:/data/libraries/com/google/code/gson/gson/2.10.1/gson-2.10.1.jar'
        result = json.loads(run(['docker', 'exec', '-e', 'QD_QA_FIXTURE=isolated-rcon-transaction', name,
            'java', '-cp', cp, 'dev.qiandeng.rconqa.RconConcurrentClient', 'single', text]))['raw']
        with (folder / 'responses.jsonl').open('a', encoding='utf-8') as stream:
            stream.write(json.dumps({'command': text, 'response': result}, ensure_ascii=False) + '\n')
        return result.strip()
    class Native:
        writes = 0
        def cmd(self, text):
            if text.startswith('execute '):
                self.writes += 1
            return command(text)
    report = {'schema': 1, 'productionMessages': 0, 'modelCalls': 0, 'clientRenderingTested': False}
    started = False
    try:
        run(['docker', 'run', '-d', '--name', name, '--hostname', 'localhost', '--network', 'none', '-e', 'QD_QA_FIXTURE=isolated-survivor-chat',
            '-e', 'RCON_PASSWORD=' + password, '--mount', 'type=bind,source=' + str(data) + ',target=/data',
            '--mount', 'type=bind,source=' + str(ROOT / 'server/mc/libraries') + ',target=/data/libraries,readonly',
            '-w', '/data', '--entrypoint', 'java', 'itzg/minecraft-server:java21', '-Xms256M', '-Xmx1G',
            '@libraries/net/neoforged/neoforge/21.1.248/unix_args.txt', 'nogui'])
        started = True
        print(json.dumps({'stage': 'isolated_server_starting', 'folder': str(folder)}), flush=True)
        deadline = time.monotonic() + 180
        while True:
            try:
                if command('qdchatqa status').startswith('QD_CHAT_QA '):
                    break
            except RuntimeError:
                pass
            if time.monotonic() >= deadline:
                raise RuntimeError('isolated_chat_server_start_timeout')
            time.sleep(2)
        state = folder / 'state'
        now = time.time()
        turn = 'survival-chat-native-0001'
        write_json(state / 'control.json', {'schema': 1, 'enabled': True})
        write_json(state / 'lease.json', {'schema': 1, 'turnId': turn, 'status': 'open',
            'expiresAt': (now + 60) * 1000, 'actionLimit': 6, 'actionsUsed': 0})
        actor = '11111111-1111-4111-8111-111111111111'
        transport = Native()
        assert command('qdchatqa setup') == 'QD_CHAT_SETUP'
        gateway = SimpleNamespace(state=state, clock=lambda: now, rcon=transport,
            _check_binding=lambda: ('Kirito', actor), _settings=lambda: {'bodyUuid': actor})
        tool = ChatTools(gateway, SkillTools(state, clock=gateway.clock), None)
        text = '原生公屏验证："}] run kill @a; /stop 只是台词。'
        first = tool.say(turn, text, voice=False)
        repeated = tool.say(turn, text, voice=False)
        native = json.loads(command('qdchatqa status').removeprefix('QD_CHAT_QA '))
        assert first['ok'] and first['textDelivery']['serverSent'], first
        assert first == repeated and transport.writes == 1, native
        assert native['heard'] == ['Observer:[附近] Kirito：' + text], native
        assert command('qdchatqa remove_viewers') == 'QD_CHAT_VIEWERS_REMOVED'
        now += 11
        turn = 'survival-chat-native-0002'
        write_json(state / 'lease.json', {'schema': 1, 'turnId': turn, 'status': 'open',
            'expiresAt': (now + 60) * 1000, 'actionLimit': 6, 'actionsUsed': 0})
        empty = tool.say(turn, 'This has no nearby audience.', voice=False)
        assert empty['textDelivery']['status'] == 'not_sent', empty
        report.update(ok=True, textReceipt=first, native=native,
            noAudienceReceipt=empty, sameDimensionNearbyOnly=True, duplicateNativeWrites=0, literalTextPreserved=True)
    finally:
        if started:
            run(['docker', 'stop', '-t', '20', name], timeout=45)
            report['isolatedContainerStopped'] = True
        (folder / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), 'utf-8')
    print(json.dumps({'report': str(folder / 'result.json'), **report}, ensure_ascii=True))


if __name__ == '__main__':
    main()
