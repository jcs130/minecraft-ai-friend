"""Resolve only the 2026-09-13 Kirito OCCLUDED placement from archived evidence.

Default is read-only. Host execution streams this code and evidence into the
existing survivor container, so apply shares its Linux action lock. No game or
model mutation is sent. The controller remains paused; the original unknown
receipt is retained in an immutable intent before the current receipt changes.
"""
from __future__ import annotations

import argparse
import base64
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

ACTION = 'e403c77593c74954b1d800f5f14ecd55'
TASK = 'task-c7a50e7a296e'
TURN = 'survival-350bce5e98094128aaba50cf5e41f022'
BODY = 'd4ac9523-4962-43ed-98c5-19b49e104048'
SESSION = 'life-e5222596680d4720ba79d8527eae078d'
ARGS = {'item_id': 'minecraft:oak_planks', 'x': -639, 'y': 64, 'z': 1052}
ACCEPTED_AT = 1789313431951
NATIVE_FAILURE = ('aim -639,63,1052 is blocked from here — the crosshair lands on short_grass '
                  'at -640,64,1051 instead. break_block that blocker, or goto the target\'s '
                  'open side, then retry.')
PACKED_EVIDENCE = None


def require(condition, code):
    if not condition:
        raise ValueError(code)


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False).encode('utf8')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def read_bytes(path, limit=2 * 1024 * 1024):
    path = Path(path)
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'symlink_refused')
    with path.open('rb') as stream:
        raw = stream.read(limit + 1)
    require(len(raw) <= limit, 'evidence_too_large')
    return raw


def load(path):
    value = json.loads(read_bytes(path).decode('utf-8-sig'))
    require(isinstance(value, dict), 'invalid_state_document')
    return value


def sync_dir(path):
    if os.name != 'nt':
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def immutable(path, value):
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('xb') as stream:
            stream.write(encoded(value) + b'\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path)
        sync_dir(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def native_proof(native):
    result = native.get('result') or {}
    require(native.get('status') == 'finished' and result.get('status') in ('completed', 'failed', 'cancelled'),
            'native_task_not_terminal')
    require(result.get('session_id') == SESSION, 'native_session_mismatch')
    calls, replies = {}, []
    for message in result.get('output', []):
        if not isinstance(message, dict):
            continue
        for part in message.get('content', []):
            data = part.get('data') if isinstance(part, dict) else None
            if not isinstance(data, dict) or data.get('name') != 'numen_survival__place_block':
                continue
            if message.get('role') == 'assistant' and 'arguments' in data:
                args = data['arguments']
                calls[data.get('call_id')] = json.loads(args) if isinstance(args, str) else args
            if message.get('role') == 'tool' and data.get('state') == 'success':
                output = data.get('output')
                output = json.loads(output) if isinstance(output, str) else output
                if (isinstance(output, dict) and output.get('actionId') == ACTION
                        and output.get('ok') is False and output.get('code') == 'outcome_unknown'):
                    replies.append((data.get('call_id'), output))
    require(len(replies) == 1, 'native_original_receipt_missing_or_ambiguous')
    call_id, reply = replies[0]
    require(calls.get(call_id) == ARGS | {'turn_id': TURN}, 'native_original_arguments_mismatch')
    return {'taskId': TASK, 'callId': call_id, 'sessionId': SESSION,
            'status': native['status'], 'resultStatus': result['status'],
            'arguments': calls[call_id], 'originalReceipt': reply, 'nativeSha256': digest(encoded(native))}


def validate_evidence(evidence):
    raw_log = base64.b64decode(evidence['nativeLogBase64'], validate=True)
    raw_observation = base64.b64decode(evidence['observationBase64'], validate=True)
    require(len(raw_log) <= 2 * 1024 * 1024 and len(raw_observation) <= 2 * 1024 * 1024, 'evidence_too_large')
    rows = [row for row in raw_log.decode('utf8').splitlines() if 'InteractAtCompanionTask FAILED(' in row]
    require(len(rows) == 1 and '[numen-task] InteractAtCompanionTask FAILED(OCCLUDED) ' + NATIVE_FAILURE in rows[0],
            'native_failure_log_missing_or_ambiguous')
    stamp = rows[0].split(' ', 1)[0]
    failure_at = int(datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp() * 1000)
    require(ACCEPTED_AT <= failure_at <= ACCEPTED_AT + 5000, 'native_failure_time_mismatch')
    observed = json.loads(raw_observation.decode('utf-8-sig'))
    require(observed.get('body', {}).get('bodyUuid') == BODY and observed['body'].get('ok') is True
            and observed['body'].get('task', {}).get('busy') is False
            and observed.get('counts', {}).get(ARGS['item_id']) == 3, 'historical_body_observation_mismatch')
    blocks = observed.get('blocks', [])
    points = {(b.get('x'), b.get('y'), b.get('z')): b.get('block') for b in blocks}
    expected = {(x, y, z) for x in range(-640, -637) for y in range(63, 66) for z in range(1051, 1054)}
    require(len(blocks) == 27 and set(points) == expected and ARGS['item_id'] not in points.values()
            and points[-639, 64, 1052] == 'minecraft:air'
            and points[-640, 64, 1051] == 'minecraft:short_grass', 'historical_world_observation_mismatch')
    return {'nativeLogSha256': digest(raw_log), 'observationSha256': digest(raw_observation),
            'nativeFailureAt': failure_at, 'nativeFailureLine': rows[0],
            'basis': 'original_native_call_and_serial_action_time_correlated_to_exact_target_failure_log',
            'nativeRequestIdReceiptAvailable': False,
            'worldUnchangedIsSupplementaryOnly': True}


def idle(backend):
    status = backend.api('GET', '/agents/qd-survivor/agent-status')
    require(status.get('status') == 'idle' and type(status.get('running_task_count')) is int
            and status['running_task_count'] == 0
            and status.get('active_tasks', []) in ([], 0), 'native_role_not_idle')
    return status


def reconcile(state, evidence, gateway, backend, *, execute=False, checkpoint=lambda _: None):
    """Caller must hold numen_gateway.action_lock, including during readbacks."""
    from numen_gateway import write_json
    state = Path(state)
    folder = state / 'reconciled-actions' / ACTION
    intent_path, done_path = folder / 'intent.json', folder / 'applied.json'
    prior = load(intent_path) if intent_path.exists() else None
    receipt_path = state / 'action-receipts' / (ACTION + '.json')
    unknown_path = state / 'unknown.json'
    if prior:
        require(prior.get('actionId') == ACTION and prior.get('taskId') == TASK
                and prior.get('phase') == 'prepared', 'reconciliation_identity_conflict')
        require(evidence == prior.get('sourceEvidence'), 'source_evidence_changed')
    if done_path.exists():
        done = load(done_path)
        require(prior and done.get('intentSha256') == digest(encoded(prior)), 'applied_proof_mismatch')
        return done | {'alreadyResolved': True}

    documents = ('control.json', 'controller.json', 'settings.json', 'life-session.json', 'lease.json', 'last-action.json')
    raw = {name: read_bytes(state / name) for name in documents}
    values = {name: json.loads(value.decode('utf-8-sig')) for name, value in raw.items()}
    control, controller = values['control.json'], values['controller.json']
    session, settings = values['life-session.json'], values['settings.json']
    lease = values['lease.json']
    unknown = load(unknown_path) if unknown_path.exists() else (prior or {}).get('originalUnknown')
    require(control.get('enabled') is False and controller.get('status') in ('paused', 'stopped')
            and not controller.get('active'), 'controller_not_paused_idle')
    require(not (state / 'inflight-action.json').exists(), 'another_action_in_flight')
    job = load(state / 'skill-job.json') if (state / 'skill-job.json').exists() else {}
    require(job.get('status') not in ('running', 'pending', 'dispatching'), 'skill_job_not_idle')
    require(isinstance(unknown, dict) and unknown.get('schema') == 1 and unknown.get('actionId') == ACTION
            and unknown.get('turnId') == TURN and unknown.get('tool') == 'place_block'
            and unknown.get('args') == ARGS and unknown.get('acceptedAt') == ACCEPTED_AT
            and unknown.get('result') == 'unknown' and unknown.get('before', {}).get('bodyUuid') == BODY
            and unknown['before'].get('counts', {}).get(ARGS['item_id']) == 3, 'unknown_identity_mismatch')
    require(session.get('agentId') == 'qd-survivor' and session.get('bodyUuid') == BODY
            and session.get('primarySessionId') == SESSION and settings.get('bodyUuid') == BODY,
            'session_or_body_identity_mismatch')
    require(values['last-action.json'].get('actionId') == ACTION, 'last_action_changed')
    current_receipt = load(receipt_path)
    old_lease = prior['originalLease'] if prior else lease
    old_receipt = prior['originalReceipt'] if prior else current_receipt
    require(old_lease.get('schema') == 1 and old_lease.get('actionId') == ACTION and old_lease.get('turnId') == TURN
            and old_lease.get('status') == 'unknown' and old_lease.get('actionsUsed') == 4
            and old_lease.get('actionLimit') == 6 and old_lease.get('expiresAt', 0) < int(time.time() * 1000),
            'old_lease_mismatch_or_still_valid')
    require(old_receipt == unknown | {'schema': 2, 'status': 'unknown', 'completionConfirmed': False},
            'original_receipt_mismatch')
    source_proof = validate_evidence(evidence)
    resolution = {'status': 'resolved_native_rejection_observed', 'actionId': ACTION,
                  'archive': str(folder), 'nativeFailure': 'OCCLUDED', 'sourceProof': source_proof}
    closed = old_lease | {'status': 'closed', 'reconciliation': resolution}
    rejected = old_receipt | {'status': 'rejected', 'completionConfirmed': False,
        'originalResult': old_receipt['result'], 'reconciliation': resolution,
        'result': {'ok': False, 'code': 'action_rejected', 'actionId': ACTION,
                   'result': {'success': False, 'message': NATIVE_FAILURE,
                              'data': {'historicalLogReconciliation': True, 'nativeFailure': 'OCCLUDED'}}}}
    require(lease in (old_lease, closed) and current_receipt in (old_receipt, rejected), 'action_state_changed')
    native_status = idle(backend)
    if prior is None:
        native = backend.poll(TASK)
        proof = native_proof(native)
        from world_actions import WorldActions
        body = gateway.snapshot()
        require(body.get('ok') is True and body.get('bodyUuid') == BODY and body.get('hp', 0) > 0
                and body.get('dimension') == 'minecraft:overworld' and body.get('task', {}).get('busy') is False,
                'live_body_not_idle')
        counts = body.get('counts', {})
        require(counts.get(ARGS['item_id']) == 3, 'live_material_count_changed')
        target = WorldActions(gateway).inspect(ARGS['x'], ARGS['y'], ARGS['z'])
        require(target.get('ok') is True and target.get('block') == 'minecraft:air', 'live_target_changed')
        fresh = {'body': body, 'counts': counts, 'target': target, 'observedAt': int(time.time() * 1000)}
    else:
        require(unknown == prior.get('originalUnknown') and session == prior.get('session'), 'archived_identity_changed')
        native, proof, fresh = prior['nativeTask'], prior['nativeProof'], prior['freshObservation']
        require(native_proof(native) == proof, 'archived_native_proof_invalid')
    require(load(state / 'control.json') == control and not load(state / 'controller.json').get('active'),
            'controller_changed_before_commit')
    idle(backend)
    preview = {'schema': 1, 'status': resolution['status'], 'actionId': ACTION, 'taskId': TASK,
               'turnId': TURN, 'sessionId': SESSION, 'nativeFailure': 'OCCLUDED',
               'originalOutcome': 'outcome_unknown', 'actionReplayed': False, 'controllerResumed': False,
               'completionConfirmed': False, 'inventoryChanged': False, 'actionBudgetRefunded': False,
               'archive': str(folder), 'sourceProof': source_proof}
    if not execute:
        return preview | {'phase': 'preview', 'applied': False}
    if prior is None:
        raw.update({'unknown.json': read_bytes(unknown_path), 'action-receipt.json': read_bytes(receipt_path)})
        for name in ('skill-job.json', 'turn-index.json'):
            if (state / name).exists():
                raw[name] = read_bytes(state / name)
        prior = preview | {'phase': 'prepared', 'createdAt': int(time.time() * 1000),
            'originalUnknown': unknown, 'originalReceipt': old_receipt, 'originalLease': old_lease,
            'session': session, 'nativeTask': native, 'nativeProof': proof, 'nativeRoleStatus': native_status,
            'freshObservation': fresh, 'sourceEvidence': evidence,
            'originalFilesBase64': {name: base64.b64encode(value).decode('ascii') for name, value in raw.items()}}
        folder.mkdir(parents=True, exist_ok=True)
        immutable(intent_path, prior)
    checkpoint('archived')
    require(load(receipt_path) in (old_receipt, rejected) and load(state / 'lease.json') in (old_lease, closed),
            'action_changed_before_write')
    if unknown_path.exists():
        require(load(unknown_path) == unknown, 'unknown_changed_before_write')
    write_json(receipt_path, rejected)
    checkpoint('receipt_rejected')
    write_json(state / 'lease.json', closed)
    checkpoint('lease_closed')
    if unknown_path.exists():
        require(load(unknown_path) == unknown, 'unknown_changed_before_clear')
        unknown_path.unlink()
        sync_dir(state)
    checkpoint('unknown_cleared')
    require(load(receipt_path) == rejected and load(state / 'lease.json') == closed and not unknown_path.exists(),
            'reconciliation_readback_failed')
    done = preview | {'phase': 'applied', 'applied': True, 'intentSha256': digest(encoded(prior)),
                      'appliedAt': int(time.time() * 1000)}
    immutable(done_path, done)
    return done


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--log-evidence')
    parser.add_argument('--observation')
    parser.add_argument('--execute', choices=['qiandengji'])
    parser.add_argument('--inside-container', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not args.inside_container:
        require(args.log_evidence and args.observation, 'evidence_paths_required')
        evidence = {'nativeLogBase64': base64.b64encode(read_bytes(args.log_evidence)).decode('ascii'),
                    'observationBase64': base64.b64encode(read_bytes(args.observation)).decode('ascii')}
        validate_evidence(evidence)
        code = read_bytes(__file__).decode('utf8').replace('PACKED_EVIDENCE = None', 'PACKED_EVIDENCE = ' + repr(evidence), 1)
        cmd = ['docker', 'exec', '-i', 'qiandengji-survivor-1', 'python', '-B', '-', '--inside-container']
        if args.execute:
            cmd += ['--execute', args.execute]
        result = subprocess.run(cmd, input=code.encode('utf8'), capture_output=True, timeout=120)
        sys.stdout.buffer.write(result.stdout)
        if result.returncode:
            sys.stderr.write('Reconciliation refused; no action was replayed.\n')
        return result.returncode
    sys.path.insert(0, '/survival')
    from numen_gateway import NumenGateway, action_lock
    from controller import QwenBackend
    state = Path('/state/survival')
    with action_lock(state):
        receipt = reconcile(state, PACKED_EVIDENCE, NumenGateway(state), QwenBackend(), execute=bool(args.execute))
    print(json.dumps(receipt, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        code = str(exc) if type(exc) is ValueError and re.fullmatch('[a-z_]+', str(exc)) else type(exc).__name__
        print(json.dumps({'ok': False, 'code': code, 'actionReplayed': False}))
        raise SystemExit(1)
