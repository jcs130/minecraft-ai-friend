"""Real mining receipt QA in a new private world; never deploys or mounts production saves."""
import base64
import json
from pathlib import Path
import shutil
import time
import uuid

import smoke_world_interaction as fixture

ROOT = fixture.ROOT
BODY = fixture.BODY
PREFIX = fixture.PREFIX
SOURCE = ROOT / 'world/irons-bridge-src/qa/MiningQa.java'
CLIENT = r'''
import json,sys,time,uuid
from pathlib import Path
from numen_gateway import RconClient,NumenGateway
from mine_actions import MineActions
body='d4ac9523-4962-43ed-98c5-19b49e104048';request=uuid.uuid4().hex
mode=sys.argv[1];native=RconClient(host='mc',port=25575,secret=Path('/qa/rcon-secret'));commands=[]
class Transport:
    def cmd(self,command):
        assert command.startswith(('qdworld mine '+body+' '+request+' ', 'qdworld mining '+body+' '+request))
        commands.append(command);raw=native.cmd(command)
        if len(commands)==1 and mode=='lost-ack':raise ConnectionError('injected_lost_ack')
        return raw
gateway=NumenGateway(Path('/tmp/mining-state'),rcon=Transport());client=MineActions(gateway)
before={'bodyUuid':body,'dimension':'minecraft:overworld'};args={'block_ids':['minecraft:oak_log'],'count':1}
reply=client.dispatch(request,before,args);receipt={'actionId':request,'before':before,'args':args,'result':{'result':reply}}
terminal=reply['nativeMineReceipt'];deadline=time.monotonic()+75
while terminal.get('status')!='terminal' and time.monotonic()<deadline:
    time.sleep(.25);terminal=client.terminal(receipt) or {}
print(json.dumps({'actionId':request,'reply':reply,'terminal':terminal,'commands':commands}))
'''


def main():
    fixture.SOURCE = SOURCE
    folder = fixture.prepare()
    candidate = fixture.DEFAULT_JAR
    build = json.loads(candidate.with_name('build-record.json').read_text('utf8'))
    assert build['ok'] and build['sha256'] == fixture.sha(candidate)
    for name, digest in build['sources'].items():
        assert fixture.sha(ROOT / name) == digest, name
    shutil.copyfile(candidate, folder / 'data/mods' / candidate.name)
    fixture.PYTHON_SOURCES = ('world_actions.py', 'numen_gateway.py', 'food_actions.py', 'mine_actions.py')
    fixture.PYTHON_CLIENT = CLIENT
    python_record = fixture.python_fixture(folder)
    record = json.loads((folder / 'prepared.json').read_text('utf8'))
    base = ['docker', 'compose', '-p', record['project'], '-f', str(folder / 'compose.json')]
    checks, details = {}, {}
    complete = False
    def command(text):
        return fixture.run([*base, 'exec', '-T', 'mc', 'rcon-cli', text], timeout=45).stdout
    def response(text, prefix='QD_MINING_QA '):
        raw = command(text)
        if prefix not in raw:
            raise ValueError('missing_native_reply:' + raw[-500:])
        return json.JSONDecoder().raw_decode(''.join(raw.split(prefix, 1)[1].splitlines()))[0]
    def status(): return response('qdminingqa status')
    def boot():
        deadline = time.monotonic() + 420
        while time.monotonic() < deadline:
            try:
                if status().get('ok'): return
            except (RuntimeError, ValueError): pass
            time.sleep(3)
        raise RuntimeError('isolated_boot_failed')
    def ground():
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            value = status()
            if value.get('onGround') and not value['currentTask']: return value
            time.sleep(.25)
        raise RuntimeError('fixture_not_idle')
    def payload(args): return base64.urlsafe_b64encode(json.dumps(args).encode()).decode().rstrip('=')
    def query(request): return response(f'qdworld mining {BODY} {request}', PREFIX)
    def submit(request, args): return response(f'qdworld mine {BODY} {request} ' + payload(args), PREFIX)
    def terminal(request, first):
        row = first; deadline = time.monotonic() + 75
        while row.get('status') in ('accepted', 'running') and time.monotonic() < deadline:
            time.sleep(.25); row = query(request)
        return row
    def stable(row): return {key: value for key, value in row.items() if key != 'observedAt'}
    def checkpoint(stage):
        fixture.write(folder / 'progress.json', {'stage': stage, 'checks': checks, 'details': details})
        print(json.dumps({'stage': stage, 'checks': checks}), flush=True)
    oak_args = {'block_ids': ['minecraft:oak_log'], 'count': 1}
    try:
        fixture.run([*base, 'up', '-d'], timeout=180); boot()
        checks['actual-neoforge-start'] = True
        assert response('qdminingqa setup')['ok']; ground()
        for mode in ('normal', 'lost-ack'):
            assert response('qdminingqa arrange')['ok']; before = ground()
            output = fixture.run([*base, 'run', '--rm', '--no-deps', '-T', 'python-qa', mode], timeout=90)
            client = json.loads(output.stdout.strip()); after = ground(); end = client['terminal']
            details[mode] = {'client': client, 'before': before, 'after': after}
            checks[mode + '-native-success-with-picked-up-item'] = end['status'] == 'terminal' and end['nativeState'] == 'SUCCESS' and end['result']['data']['gathered'] >= 1 and after['oak'] - before['oak'] >= 1
            checks[mode + '-one-native-dispatch'] = sum(text.startswith('qdworld mine ') for text in client['commands']) == 1
            checks[mode + '-local-loaded-candidates-only'] = end['miningSelection']['radius'] == 16 and end['miningSelection']['candidateCount'] == 3 and after['farOakIntact']
            duplicate = submit(client['actionId'], oak_args)
            checks[mode + '-duplicate-keeps-original-task-no-extra-pickup'] = stable(duplicate) == stable(end) and ground()['oak'] == after['oak']
            assert all(checks.values()), checks
            checkpoint(mode + '-verified')
        no_target = submit(uuid.uuid4().hex, {'block_ids': ['minecraft:netherite_block'], 'count': 1})
        checks['absent-target-rejected-before-dispatch'] = no_target['status'] == 'rejected' and no_target['code'] == 'no_loaded_mining_targets' and no_target['dispatched'] is False
        assert response('qdminingqa arrange')['ok']; ground()
        failed_id = uuid.uuid4().hex
        failed = terminal(failed_id, submit(failed_id, {'block_ids': ['minecraft:diamond_ore'], 'count': 1}))
        details['wrong-tool'] = failed
        checks['wrong-tool-native-failure-preserves-reason'] = failed['status'] == 'terminal' and failed['nativeState'] == 'FAILED' and failed['result']['success'] is False and 'harvest' in failed['result']['message'] and ground()['diamond'] == 0
        assert response('qdminingqa arrange_timeout')['ok']; ground()
        timeout_id = uuid.uuid4().hex
        timeout_accepted = submit(timeout_id, oak_args)
        assert timeout_accepted['status'] == 'accepted', timeout_accepted
        accelerated = response('qdminingqa timeout_' + timeout_id)
        assert accelerated['ok'], accelerated
        timeout = terminal(timeout_id, query(timeout_id)); details['accelerated-native-timeout'] = {'clock': accelerated, 'terminal': timeout}
        checks['native-slot-timeout-is-exact-terminal'] = timeout['status'] == 'terminal' and timeout['nativeState'] == 'TIMEOUT' and timeout['nativeTaskId'] == accelerated['originalTask'] and timeout['result']['data']['gathered'] == 0
        checkpoint('failure-timeout-verified'); assert all(checks.values()), checks
        assert response('qdminingqa arrange')['ok']; before_restart = ground()
        pending_id = uuid.uuid4().hex; assert response('qdminingqa arm_' + pending_id)['ok']
        command('save-all flush'); fixture.run([*base, 'stop', '-t', '60', 'mc'], timeout=100)
        journal = folder / 'data/qa-world/data/qiandeng-interactions' / (BODY + '-' + pending_id + '.json')
        pending = json.loads(journal.read_text('utf8')); digest = fixture.sha(journal)
        checks['real-mining-accepted-at-final-shutdown-tick'] = pending['status'] == 'accepted'
        fixture.run([*base, 'start', 'mc'], timeout=60); boot()
        assert response('qdminingqa restore')['ok']; after_restart = ground()
        unknown, duplicate, old = query(pending_id), submit(pending_id, oak_args), query(timeout_id)
        details['restart'] = {'pending': pending, 'unknown': unknown, 'duplicate': duplicate, 'before': before_restart, 'after': after_restart}
        checks['interrupted-request-never-replayed'] = unknown['status'] == 'unknown' and duplicate['status'] == 'unknown' and fixture.sha(journal) == digest and after_restart['oak'] == before_restart['oak'] and after_restart['persistedTaskTool'] == ''
        checks['old-terminal-survives-restart-with-original-epoch'] = stable(old) == stable(timeout)
        checkpoint('restart-verified'); assert all(checks.values()), checks
        complete = True
    finally:
        stopped = fixture.run([*base, 'down', '--timeout', '60'], timeout=120, check=False)
        checks['isolated-services-removed'] = stopped.returncode == 0 and not fixture.run([*base, 'ps', '-a', '-q'], check=False).stdout.strip()
        fixture.write(folder / 'result.json', {'ok': complete and all(checks.values()), 'checks': checks, 'details': details,
            'candidateSha256': fixture.sha(candidate), 'python': python_record, 'fixtureSourceSha256': fixture.sha(SOURCE),
            'productionSaveMounted': False, 'publishedPorts': []})
        print(json.dumps({'folder': str(folder), 'checks': checks}), flush=True)


if __name__ == '__main__': main()
