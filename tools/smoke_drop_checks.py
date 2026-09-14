"""Drop checks for the shared isolated 72-mod fixture; no production paths/actions."""
import base64
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
BODY = 'c580fd66-6311-46db-a839-3b0032f6d001'
PREFIX = 'QD_WORLD_INTERACTION_JSON '
CLIENT = r'''
import json,sys,uuid
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,'/fake/drop-source')
from numen_gateway import RconClient
from drop_actions import DropActions
body='c580fd66-6311-46db-a839-3b0032f6d001';request=uuid.uuid4().hex
native=RconClient(host='mc',port=25575,secret=Path('/fake/drop-rcon-secret'))
commands=[];mode=sys.argv[1]
class Transport:
    def cmd(self,command):
        assert command.startswith(('qdworld drop '+body+' '+request+' ', 'qdworld dropping '+body+' '+request))
        commands.append(command);raw=native.cmd(command)
        if len(commands)==1 and mode=='lost-ack':raise ConnectionError('injected_lost_ack_after_dispatch')
        return raw
reply=DropActions(SimpleNamespace(rcon=Transport())).dispatch(request,
    {'bodyUuid':body,'dimension':'minecraft:overworld'},{'item_id':'minecraft:paper','count':6})
print(json.dumps({'actionId':request,'reply':reply,'commands':commands}))
'''


def check_drop(*, response, command, run, base, folder, checks, details):
    folder = Path(folder).resolve()
    if not folder.is_relative_to((ROOT / 'runtime').resolve()):
        raise ValueError('isolated_drop_folder_required')
    compose = json.loads((folder / 'compose.json').read_text('utf8'))
    if compose['services']['mc']['environment'].get('QD_QA_FIXTURE') != 'isolated-maid-bridge':
        raise ValueError('isolated_drop_compose_required')
    fake = folder / 'fake'
    sources = fake / 'drop-source'; sources.mkdir()
    hashes = {}
    for name in ('drop_actions.py', 'numen_gateway.py'):
        source = ROOT / 'world/survival' / name
        shutil.copyfile(source, sources / name)
        hashes[name] = hashlib.sha256(source.read_bytes()).hexdigest()
    (fake / 'drop_client.py').write_text(CLIENT, 'utf8')
    (fake / 'drop-rcon-secret').write_text(compose['services']['mc']['environment']['RCON_PASSWORD'], 'ascii')
    details['dropSources'] = hashes
    def fixture(action):
        value = response('qddropqa ' + action, 'QD_DROP_QA ')
        assert value.get('ok') is True, value
        return value
    def client(mode):
        output = run([*base, 'exec', '-T', 'npc', 'python', '/fake/drop_client.py', mode], timeout=30)
        return json.loads(output.stdout.strip())
    payload = base64.urlsafe_b64encode(json.dumps({'item_id':'minecraft:paper','count':6}).encode()).decode().rstrip('=')
    for mode in ('normal', 'lost-ack'):
        before = fixture('setup')
        result = client(mode)
        after = fixture('status')
        receipt = result['reply']['nativeDropReceipt']
        entities = after['entities']
        checks['drop-' + mode + '-native-components'] = (result['reply']['success'] is True
            and receipt['nativeState'] == 'SUCCESS' and after['inventoryPaper'] == before['inventoryPaper'] - 6
            and sum(row['count'] for row in entities if row['alphaComponents']) == 4
            and sum(row['count'] for row in entities if row['betaComponents']) == 2
            and len(entities) == 2)
        checks['drop-' + mode + '-one-send-query-only'] = (len(result['commands']) >= (2 if mode == 'lost-ack' else 1)
            and result['commands'][0].startswith('qdworld drop ')
            and all(value == f"qdworld dropping {BODY} {result['actionId']}" for value in result['commands'][1:]))
        repeated = response(f"qdworld drop {BODY} {result['actionId']} {payload}", PREFIX)
        stable = lambda row: {k:v for k,v in row.items() if k != 'observedAt'}
        checks['drop-' + mode + '-duplicate-no-spend'] = stable(repeated) == stable(receipt) and fixture('status')['inventoryPaper'] == 2
        checks['drop-' + mode + '-pickup-not-claimed'] = receipt['result']['data']['pickup_confirmed'] is False
        details['drop-' + mode] = {'before':before,'client':result,'after':after,'repeated':repeated}
        assert all(value for key,value in checks.items() if key.startswith('drop-' + mode)), details['drop-' + mode]
    fixture('setup'); fixture('cancel_next')
    cancelled = client('cancelled'); after_cancel = fixture('status')
    checks['drop-cancelled-keeps-components-and-quantity'] = (cancelled['reply']['success'] is False
        and cancelled['reply']['nativeDropReceipt']['status'] == 'terminal'
        and after_cancel['inventoryPaper'] == 8 and after_cancel['slot0'] == 4 and after_cancel['slot1'] == 4
        and after_cancel['slot0AlphaComponents'] and after_cancel['slot1BetaComponents']
        and not after_cancel['entities'])
    details['drop-cancelled'] = {'client':cancelled,'after':after_cancel}
    assert checks['drop-cancelled-keeps-components-and-quantity'], details['drop-cancelled']
