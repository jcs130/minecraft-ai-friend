"""Native damage/death, same-body rescue and durable replay in the existing isolated harness."""
import hashlib
import json
import time
import uuid


def check_rescue(*, response, command, run, base, data, fake, checks, details):
    def qa(action):
        value = response('qdyuiqa ' + action, 'QD_YUI_QA ')
        if not value.get('ok'): raise RuntimeError('fixture_failed: ' + str(value))
        return value
    def rescue(text):
        return response('qdmaid ' + text, 'QD_RESCUE_JSON ')
    def inspect():
        value = rescue('rescue_inspect ' + str(uuid.uuid4()))
        if value.get('phase') != 'observed': raise RuntimeError('inspect_failed: ' + str(value))
        return value
    setup = qa('setup'); details['setup'] = setup
    checks['exact-protection-loaded'] = all(setup['protection'].get(k) is True for k in
        ('configMatched', 'nativeInvulnerable', 'tlmInvulnerable', 'damageGuard', 'deathGuard', 'alive'))
    proof = qa('protection'); details['protection'] = proof
    for key in ('ordinaryRejected', 'voidRejected', 'killPrevented', 'healthUnchanged', 'directDeathPrevented',
                'savedInvulnerable', 'nativeLoadInvulnerable', 'otherBodyUnprotected', 'wrongOwnerUnprotected', 'identityAiPreserved'):
        checks['native-' + key] = proof.get(key) is True
    first = inspect(); details['initialQuote'] = first
    checks['real-safe-landings'] = all(isinstance(first['safeLandings'][k], dict) for k in ('kirito', 'yui'))
    qa('move_kirito')
    moved = rescue('rescue ' + str(uuid.uuid4()) + ' ' + first['quoteId'] + ' kirito')
    checks['source-movement-refused'] = moved['phase'] == 'rejected' and moved['code'] == 'quote_source_moved'
    quote = inspect()
    blocked = quote['safeLandings']['kirito']['position']
    x, y, z = int(blocked[0] // 1), int(blocked[1]), int(blocked[2] // 1)
    command(f'setblock {x} {y} {z} minecraft:stone')
    denied = rescue('rescue ' + str(uuid.uuid4()) + ' ' + quote['quoteId'] + ' kirito')
    checks['landing-rechecked-before-effect'] = denied['phase'] == 'rejected' and denied['code'] == 'landing_changed'
    command(f'setblock {x} {y} {z} minecraft:air')
    quote = inspect(); action = str(uuid.uuid4())
    done = rescue('rescue ' + action + ' ' + quote['quoteId'] + ' kirito'); details['kiritoRescue'] = done
    checks['kirito-native-teleport-confirmed'] = done.get('executionConfirmed') is True and done['phase'] == 'completed'
    checks['kirito-original-body-raised'] = done.get('before', {}).get('bodyUuid') == done.get('after', {}).get('bodyUuid') == setup['kiritoUuid'] and done.get('after', {}).get('position', [0, -999])[1] > done.get('before', {}).get('position', [0, 999])[1]
    replay = rescue('rescue ' + action + ' ' + quote['quoteId'] + ' kirito')
    checks['same-action-no-second-teleport'] = replay == done
    conflict = rescue('rescue ' + action + ' ' + quote['quoteId'] + ' yui')
    checks['action-collision-preserves-original'] = conflict['code'] == 'request_id_conflict' and rescue('rescue_status ' + action) == done
    later = rescue('rescue ' + str(uuid.uuid4()) + ' ' + quote['quoteId'] + ' kirito')
    checks['old-quote-no-second-effect'] = later['phase'] == 'rejected' and later.get('executionConfirmed') is False
    yquote = inspect(); yaction = str(uuid.uuid4())
    ydone = rescue('rescue ' + yaction + ' ' + yquote['quoteId'] + ' yui'); details['yuiRescue'] = ydone
    checks['yui-native-same-body-teleport'] = ydone.get('executionConfirmed') is True and ydone.get('after', {}).get('bodyUuid') == setup['yuiUuid']
    # A persisted pre-effect claim simulates process failure. Query/repeat must not resume the effect.
    unknown_id = str(uuid.uuid4()); payload = {'requestId': unknown_id, 'quoteId': yquote['quoteId'], 'target': 'yui'}
    unknown = {'schema': 1, **payload, 'phase': 'unknown', 'code': 'outcome_unknown', 'ok': False, 'executionConfirmed': False}
    row = {'fingerprint': hashlib.sha256(json.dumps(payload, separators=(',', ':')).encode()).hexdigest(),
           'finished': False, 'input': payload, 'receipt': unknown}
    journal = data / 'data/qiandeng-maid-bridge/rescue'
    (journal / ('action-' + unknown_id + '.json')).write_text(json.dumps(row), 'utf8')
    checks['interrupted-claim-never-replayed'] = rescue('rescue ' + unknown_id + ' ' + yquote['quoteId'] + ' yui') == unknown
    command('save-all flush'); run([*base, 'restart', 'mc'], timeout=120)
    deadline = time.monotonic() + 300
    while time.monotonic() < deadline:
        try:
            restored = qa('restore_owner')
            if restored.get('yuiUuid') == setup['yuiUuid']: break
        except Exception: pass
        time.sleep(2)
    else: raise RuntimeError('restart_not_ready')
    details['afterRestart'] = restored
    checks['native-protection-survives-restart'] = all(restored.get('protection', {}).get(k) is True for k in
        ('configMatched', 'nativeInvulnerable', 'tlmInvulnerable', 'alive'))
    checks['completed-receipt-survives-restart'] = rescue('rescue_status ' + action) == done
    checks['unknown-survives-restart-without-replay'] = rescue('rescue_status ' + unknown_id) == unknown
    checks['no-generative-calls'] = restored['llmEnabled'] is False and not (fake / 'requests.jsonl').exists()
