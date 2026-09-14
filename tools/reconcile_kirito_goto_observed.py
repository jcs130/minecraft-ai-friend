"""One operator-only observed-effect resolution for Kirito's 2026-09-14 goto.

Default is read-only. --execute qiandengji archives evidence and a resolution
before closing the exact old lease and removing its active unknown marker.
This never recovers a lost ACK, attributes the action as verified, replays any
action, changes historical receipts, or resumes the paused controller.
"""
from __future__ import annotations

import argparse
import base64
from contextlib import nullcontext
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

ACTION = '114d50e64e3f460589e94ec5014cbcdc'
TURN = 'survival-49663ac35a5140e08018cd200d920c87'
UNKNOWN_SHA = 'b1a70f91fb708c2aeb65524d7c67af7e648ddab5a3da80ef10a15a9cd71e7ddf'
BODY = 'd4ac9523-4962-43ed-98c5-19b49e104048'
OWNER = 'e5005711-be9f-44b7-aaad-6993c0ba5df4'
SESSION = 'life-e5222596680d4720ba79d8527eae078d'
CHAT = 'cd4f732b-b343-43de-93eb-437b7ec96ac3'
EPOCH = 'fd72751d-1cfb-4856-9780-1969442560ab'
TASK = 'task-ee8f737ea22f'
NATIVE_TASK = 't554'
ACCEPTED_AT = 1789374728806
FINISHED_AT = 1789374729895
ARGS = {'x': -638.5, 'y': 63.9375, 'z': 1054.5}
DIMENSION = 'minecraft:overworld'


def require(condition, code):
    if not condition:
        raise ValueError(code)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False).encode('utf8') + b'\n'


def read_bytes(path, limit=2 * 1024 * 1024):
    path = Path(path)
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'symlink_refused')
    with path.open('rb') as stream:
        raw = stream.read(limit + 1)
    require(len(raw) <= limit, 'evidence_too_large')
    return raw


def load(path):
    value = json.loads(read_bytes(path).decode('utf-8-sig'))
    require(isinstance(value, dict), 'invalid_evidence')
    return value


def immutable_bytes(path, raw):
    path = Path(path)
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'symlink_refused')
    if path.exists():
        require(read_bytes(path) == raw, 'immutable_evidence_conflict')
        return
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('xb') as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        os.link(temporary, path)
        fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def fsync_directory(path):
    if os.name != 'nt':
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def native_proof(native):
    result = native.get('result') or {}
    require(native.get('status') == 'finished' and result.get('status') == 'completed',
            'native_task_not_completed')
    require(result.get('session_id') == SESSION, 'native_session_mismatch')
    calls, replies = {}, []
    for message in result.get('output', []):
        for part in message.get('content', []):
            data = part.get('data', {})
            if data.get('name') != 'numen_survival__move':
                continue
            call = data.get('call_id')
            if message.get('type') == 'plugin_call' and message.get('role') == 'assistant':
                require(call not in calls, 'duplicate_native_call')
                calls[call] = json.loads(data['arguments'])
            if message.get('type') == 'plugin_call_output' and message.get('role') == 'tool':
                output = json.loads(data['output'])
                if output.get('actionId') == ACTION:
                    require(data.get('state') == 'success' and output.get('ok') is False
                            and output.get('code') == 'outcome_unknown', 'native_unknown_receipt_mismatch')
                    replies.append((call, output))
    require(len(replies) == 1, 'native_receipt_missing_or_ambiguous')
    call, reply = replies[0]
    require(calls.get(call) == ARGS | {'turn_id': TURN}, 'native_arguments_mismatch')
    return {'taskId': TASK, 'status': 'finished', 'resultStatus': 'completed',
            'sessionId': SESSION, 'callId': call, 'arguments': calls[call], 'receipt': reply,
            'completedAt': result.get('completed_at'), 'sourceSha256': digest(encoded(native))}


def validate_event(proof):
    require(proof.get('bodyUuid') == BODY and proof.get('source') == 'numen_event_outbox.dat'
            and re.fullmatch('[0-9a-f]{64}', proof.get('sourceSha256', '')), 'event_source_mismatch')
    event = proof.get('event') or {}
    require(event.get('type') == 'event' and event.get('ts') == FINISHED_AT + 1
            and event.get('text') == '<event kind="task_finished" day="554" t="21:27" '
                'id="t554" task="goto" status="done">reached the exact cell -639,64,1054.</event>',
            'native_event_mismatch')


def event_from_nbt(raw):
    import gzip
    import io
    import nbtlib
    data = nbtlib.File.parse(io.BytesIO(gzip.decompress(raw))).unpack(json=True)
    entries = data.get('data', {}).get('outboxes', {}).get(BODY, [])
    events = [entry for entry in entries if entry.get('ts') == FINISHED_AT + 1
              and 'id="t554"' in entry.get('text', '')]
    require(len(events) == 1, 'native_event_missing_or_ambiguous')
    proof = {'source': 'numen_event_outbox.dat', 'sourceSha256': digest(raw),
             'bodyUuid': BODY, 'event': events[0]}
    validate_event(proof)
    return proof


def validate_navigation(body):
    require(body.get('ok') is True and body.get('bodyName') == 'Kirito' and body.get('bodyUuid') == BODY
            and body.get('dimension') == DIMENSION and body.get('hp', 0) > 0
            and body.get('task', {}).get('busy') is False, 'body_not_available_idle')
    nav = body.get('navigationResult') or {}
    require(body.get('navigationEpoch') == EPOCH and nav.get('navigation_epoch') == EPOCH,
            'native_epoch_changed')
    require(nav.get('task_id') == NATIVE_TASK and nav.get('state') == 'success'
            and nav.get('success') is True and nav.get('finished_at') == FINISHED_AT
            and nav.get('requested_y') == ARGS['y'] and nav.get('arrival_mode') == 'block_3d'
            and nav.get('navigation_mode') == 'walk_only_v1'
            and nav.get('dry_supported') is True and nav.get('world_interaction_blocked') is False,
            'native_navigation_terminal_mismatch')
    require(all(type(nav.get('final_' + axis)) in (float, int)
                and math.isfinite(nav['final_' + axis]) for axis in ('x', 'y', 'z'))
            and tuple(math.floor(nav['final_' + k]) for k in ('x', 'y', 'z')) == (-639, 64, 1054),
            'native_destination_mismatch')


def paused_idle(state, backend):
    control, controller = load(state / 'control.json'), load(state / 'controller.json')
    require(control.get('enabled') is False and control.get('pauseReason') == 'action_outcome_unknown'
            and controller.get('status') == 'paused' and not controller.get('active'), 'controller_not_paused_idle')
    require(not (state / 'inflight-action.json').exists(), 'another_action_in_flight')
    job = load(state / 'skill-job.json') if (state / 'skill-job.json').exists() else {}
    require(job.get('status') not in ('running', 'pending', 'dispatching'), 'skill_job_not_idle')
    require(backend.api('GET', '/agents/qd-survivor/agent-status').get('running_task_count') == 0,
            'native_role_not_idle')
    return control


def validate_archived_evidence(evidence):
    validate_event(evidence['event'])
    validate_navigation(evidence['body'])
    native = evidence['nativeProof']
    require(native.get('taskId') == TASK and native.get('status') == 'finished'
            and native.get('resultStatus') == 'completed' and native.get('arguments') == ARGS | {'turn_id': TURN}
            and native.get('receipt', {}).get('actionId') == ACTION
            and native['receipt'].get('ok') is False and native['receipt'].get('code') == 'outcome_unknown'
            and native.get('sessionId') == SESSION, 'archived_native_proof_mismatch')


def reconcile(state, gateway, backend, event, *, execute=False, checkpoint=lambda _: None):
    """Production caller holds the Linux shared action_lock for execute only."""
    from numen_gateway import write_json
    state = Path(state)
    require(not any(p.is_symlink() for p in (state, *state.parents)), 'symlink_refused')
    folder = state / 'reconciled-actions' / ACTION
    intent_path, resolution_path, done_path = (folder / name for name in ('intent.json', 'resolution.json', 'completed.json'))
    prior = load(intent_path) if intent_path.exists() else None
    unknown_path = state / 'unknown.json'
    unknown_raw = read_bytes(unknown_path) if unknown_path.exists() else read_bytes(folder / 'unknown-original.json')
    require(digest(unknown_raw) == UNKNOWN_SHA, 'unknown_bytes_mismatch')
    unknown = json.loads(unknown_raw)
    require(unknown.get('schema') == 1 and unknown.get('actionId') == ACTION and unknown.get('turnId') == TURN
            and unknown.get('tool') == 'goto' and unknown.get('args') == ARGS and unknown.get('result') == 'unknown'
            and unknown.get('acceptedAt') == ACCEPTED_AT and unknown.get('before', {}).get('bodyUuid') == BODY
            and unknown['before'].get('navigationEpoch') == EPOCH, 'unknown_identity_mismatch')
    settings, session = load(state / 'settings.json'), load(state / 'life-session.json')
    require((settings.get('bodyName'), settings.get('bodyUuid'), settings.get('ownerUuid'), settings.get('dimension'))
            == ('Kirito', BODY, OWNER, DIMENSION), 'settings_identity_mismatch')
    require((session.get('agentId'), session.get('bodyUuid'), session.get('primarySessionId'), session.get('chatId'),
             session.get('userId'), session.get('channel'))
            == ('qd-survivor', BODY, SESSION, CHAT, 'survival-controller', 'console'), 'session_identity_mismatch')
    lease = load(state / 'lease.json')
    original_lease = prior['originalLease'] if prior else lease
    require((original_lease.get('schema'), original_lease.get('turnId'), original_lease.get('actionId'),
             original_lease.get('status'), original_lease.get('actionsUsed'), original_lease.get('actionLimit'))
            == (1, TURN, ACTION, 'unknown', 4, 6), 'lease_identity_mismatch')
    closed = original_lease | {'status': 'closed', 'reconciliation': {
        'actionId': ACTION, 'status': 'resolved_effect_observed', 'effectAttributionVerified': False}}
    require(lease in (original_lease, closed), 'lease_changed_during_recovery')
    facts = {'schema': 1, 'actionId': ACTION, 'turnId': TURN, 'taskId': TASK, 'observedNativeTaskId': NATIVE_TASK,
             'status': 'resolved_effect_observed', 'originalOutcome': 'outcome_unknown',
             'effectAttributionVerified': False, 'originalAckRecovered': False, 'actionReplayed': False,
             'controllerResumed': False, 'historyRewritten': False, 'bodyUuid': BODY, 'sessionId': SESSION,
             'navigationEpoch': EPOCH, 'unknownSha256': UNKNOWN_SHA,
             'basis': 'operator-reviewed native arrival/event/time correlation; original dispatch ACK has no archived native task ID'}
    if prior:
        require(all(prior.get(k) == v for k, v in facts.items()) and prior.get('originalUnknown') == unknown
                and prior.get('session') == session, 'intent_identity_mismatch')
        evidence = load(folder / 'evidence.json')
        require(prior.get('evidenceSha256') == digest(read_bytes(folder / 'evidence.json'))
                and digest(read_bytes(folder / 'unknown-original.json')) == UNKNOWN_SHA, 'archived_evidence_mismatch')
        validate_archived_evidence(evidence)
    if done_path.exists():
        done = load(done_path)
        resolution = load(resolution_path)
        require(prior is not None and done.get('intentSha256') == digest(read_bytes(intent_path))
                and done.get('resolutionSha256') == digest(read_bytes(resolution_path))
                and all(done.get(k) == v and resolution.get(k) == v for k, v in facts.items())
                and done.get('localBlockerCommitComplete') is True
                and lease == closed and not unknown_path.exists(), 'completed_proof_mismatch')
        return done | {'alreadyResolved': True}
    control = paused_idle(state, backend)
    require(gateway._check_binding() == ('Kirito', BODY), 'live_binding_mismatch')
    body = gateway.snapshot()
    # Gateway's regular context projection deliberately omits requested_y and
    # dry_supported. Read the same native status once more for this operator
    # proof, and require every projected field to still agree.
    native_status = gateway._invoke('get_self_status')
    full_navigation = native_status.get('last_navigation_result') or {}
    require(native_status.get('name') == 'Kirito' and native_status.get('dimension') == DIMENSION
            and native_status.get('navigation_epoch') == body.get('navigationEpoch')
            and isinstance(body.get('navigationResult'), dict) and bool(body['navigationResult'])
            and all(full_navigation.get(k) == v for k, v in body['navigationResult'].items()),
            'navigation_changed_between_reads')
    body = body | {'navigationResult': full_navigation}
    validate_navigation(body)
    if not prior:
        require(unknown_path.exists() and lease.get('status') == 'unknown', 'missing_original_blocker')
        validate_event(event)
        evidence = {'event': event, 'body': {k: body[k] for k in
            ('ok', 'bodyName', 'bodyUuid', 'dimension', 'hp', 'task', 'navigationEpoch', 'navigationResult', 'observedAt')},
            'nativeProof': native_proof(backend.poll(TASK))}
        if (folder / 'evidence.json').exists():
            # A crash may leave fully fsynced evidence before intent creation.
            # Validate and retain those original bytes; do not overwrite them
            # with a later observation merely to make the next run succeed.
            require(digest(read_bytes(folder / 'unknown-original.json')) == UNKNOWN_SHA,
                    'partial_archive_unknown_mismatch')
            evidence = load(folder / 'evidence.json')
            validate_archived_evidence(evidence)
    require(paused_idle(state, backend) == control, 'control_changed_before_commit')
    if not execute:
        return facts | {'execute': False, 'observation': evidence, 'willCloseOnlyOriginalLease': True,
                        'willClearOnlyExactUnknown': True, 'controllerRemainsPaused': True}
    if not prior:
        folder.mkdir(parents=True, exist_ok=True)
        immutable_bytes(folder / 'unknown-original.json', unknown_raw)
        immutable_bytes(folder / 'evidence.json', encoded(evidence))
        checkpoint('evidence_archived')
        prior = facts | {'originalUnknown': unknown, 'originalLease': original_lease, 'session': session,
                         'evidenceSha256': digest(read_bytes(folder / 'evidence.json')), 'createdAt': int(time.time() * 1000)}
        immutable_bytes(intent_path, encoded(prior))
    checkpoint('intent_archived')
    resolution = facts | {'intentSha256': digest(read_bytes(intent_path)), 'localBlockerCommitPending': True}
    immutable_bytes(resolution_path, encoded(resolution))
    checkpoint('resolution_archived')
    require(paused_idle(state, backend) == control, 'activity_changed_before_close')
    require(load(state / 'lease.json') in (original_lease, closed), 'lease_changed_before_close')
    if unknown_path.exists():
        require(digest(read_bytes(unknown_path)) == UNKNOWN_SHA, 'unknown_changed_before_close')
    write_json(state / 'lease.json', closed)
    checkpoint('lease_closed')
    if unknown_path.exists():
        require(digest(read_bytes(unknown_path)) == UNKNOWN_SHA, 'unknown_changed_before_clear')
        unknown_path.unlink(); fsync_directory(state)
    checkpoint('unknown_cleared')
    done = facts | {'intentSha256': digest(read_bytes(intent_path)),
                    'resolutionSha256': digest(read_bytes(resolution_path)),
                    'localBlockerCommitComplete': True, 'completedAt': int(time.time() * 1000)}
    immutable_bytes(done_path, encoded(done))
    return done


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', choices=['qiandengji'])
    parser.add_argument('--inside-container', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not args.inside_container:
        root = Path(__file__).resolve().parents[1]
        raw = read_bytes(root / 'server/mc/shadow/data/numen_event_outbox.dat')
        envelope = {'source': Path(__file__).read_text(encoding='utf8'), 'event': base64.b64encode(raw).decode('ascii')}
        bootstrap = ('import sys,json,base64; e=json.load(sys.stdin); '
                     'exec(compile(e["source"],"<operator-goto-reconciliation>","exec"),'
                     '{"__name__":"__main__","INJECTED_EVENT_BYTES":base64.b64decode(e["event"])})')
        command = ['docker', 'exec', '-i', 'qiandengji-survivor-1', 'python', '-B', '-c', bootstrap, '--inside-container']
        if args.execute:
            command += ['--execute', args.execute]
        result = subprocess.run(command, input=encoded(envelope), capture_output=True, timeout=90)
        sys.stdout.buffer.write(result.stdout)
        if result.returncode:
            sys.stderr.write('Reconciliation refused; no action was replayed.\n')
        return result.returncode
    sys.path.insert(0, '/survival')
    from controller import QwenBackend
    from numen_gateway import NumenGateway, action_lock
    state = Path('/state/survival')
    try:
        # Preview never creates or touches the shared lock; execute uses the
        # same Linux flock as the controller and MCP inside this container.
        with action_lock(state) if args.execute else nullcontext():
            receipt = reconcile(state, NumenGateway(state), QwenBackend(), event_from_nbt(INJECTED_EVENT_BYTES),
                                execute=bool(args.execute))
        print(json.dumps(receipt, ensure_ascii=False))
        return 0
    except Exception as exc:
        code = str(exc) if type(exc) is ValueError and re.fullmatch('[a-z_]+', str(exc)) else type(exc).__name__
        print(json.dumps({'ok': False, 'code': code, 'actionReplayed': False, 'controllerResumed': False}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
