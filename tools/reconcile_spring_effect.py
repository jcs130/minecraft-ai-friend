"""Operator-only resolution of one historical spring unknown; never dispatches an effect.

Default is read-only preview. --execute qiandengji archives immutable evidence,
closes only the matching lease, then removes only that exact unknown marker.
The historical outcome, mana, learned spells and controller pause are preserved.
"""
from __future__ import annotations
import argparse
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


def require(condition, code):
    if not condition:
        raise ValueError(code)


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False).encode('utf-8')


def load(path, limit=2 * 1024 * 1024):
    path = Path(path)
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'symlink_refused')
    with path.open('rb') as stream:
        raw = stream.read(limit + 1)
    require(len(raw) <= limit, 'evidence_too_large')
    value = json.loads(raw.decode('utf-8-sig'))
    require(isinstance(value, dict), 'invalid_evidence')
    return value


def create_immutable(path, value):
    """Publish complete fsynced bytes atomically, refusing an existing proof."""
    path = Path(path)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('xb') as stream:
            stream.write(encoded(value) + b'\n'); stream.flush(); os.fsync(stream.fileno())
        os.link(temporary, path)  # atomic create-if-absent; never replaces an older intent
        if os.name != 'nt':
            fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
    finally:
        temporary.unlink(missing_ok=True)


def native_proof(native, session, unknown):
    result = native.get('result') or {}
    require(native.get('status') == 'finished' and result.get('status') in ('completed', 'failed', 'cancelled'),
            'native_task_not_terminal')
    require(result.get('session_id') == session.get('primarySessionId'), 'native_session_mismatch')
    calls, replies = {}, []
    for message in result.get('output', []):
        if not isinstance(message, dict):
            continue
        for part in message.get('content', []):
            data = part.get('data') if isinstance(part, dict) else None
            if not isinstance(data, dict) or data.get('name') != 'numen_survival__game_cast':
                continue
            if message.get('role') == 'assistant' and 'arguments' in data:
                args = data['arguments']
                calls[data.get('call_id')] = json.loads(args) if isinstance(args, str) else args
            if message.get('role') == 'tool' and data.get('state') == 'success':
                output = data.get('output')
                output = json.loads(output) if isinstance(output, str) else output
                if (isinstance(output, dict) and output.get('actionId') == unknown['actionId']
                        and output.get('ok') is False and output.get('code') == 'outcome_unknown'):
                    replies.append((data.get('call_id'), output))
    require(len(replies) == 1, 'native_original_action_receipt_missing_or_ambiguous')
    call_id, reply = replies[0]
    require(calls.get(call_id) == unknown['args'] | {'turn_id': unknown['turnId']},
            'native_original_action_arguments_mismatch')
    return {'status': native['status'], 'resultStatus': result['status'],
            'sessionId': result['session_id'], 'startedAt': native.get('started_at'),
            'callId': call_id, 'arguments': calls[call_id], 'receipt': reply,
            'nativeResultSha256': hashlib.sha256(encoded(native)).hexdigest()}


def target_of(unknown):
    from game_skills import DIRECTIONS
    args = unknown['args']
    require(unknown.get('tool') == 'game_cast' and args.get('skill_id') == 'spring', 'not_spring')
    params = args.get('params', {})
    require(set(params) <= {'direction', 'distance'}, 'unsupported_spring_parameters')
    distance = float(params.get('distance', 2))
    require(math.isfinite(distance) and 0 <= distance <= 10, 'invalid_spring_distance')
    direction = params.get('direction', '东')
    direction = {'east': '东', 'west': '西', 'north': '北', 'south': '南'}.get(direction, direction)
    require(direction in DIRECTIONS, 'unsupported_spring_direction')
    dx, dz = DIRECTIONS[direction]
    position = unknown['before']['position']
    require(all(type(position.get(k)) in (int, float) and math.isfinite(position[k]) for k in ('x', 'y', 'z')),
            'invalid_original_position')
    # mc-magic rounds the actor origin BEFORE applying the direction vector.
    rnd = lambda x: math.floor(x + .5)
    return {'dimension': unknown['before']['dimension'],
            'x': rnd(rnd(position['x']) + dx * distance), 'y': rnd(position['y']) - 1,
            'z': rnd(rnd(position['z']) + dz * distance)}


def reconcile(state, queue, action_id, request_id, task_id, gateway, backend, *, execute=False, checkpoint=lambda _: None):
    """Caller holds action_lock. checkpoint is solely for crash-recovery tests."""
    from game_skills import action_command
    from numen_gateway import write_json
    state, queue = Path(state), Path(queue)
    require(bool(re.fullmatch(r'[a-f0-9]{32}', action_id)), 'invalid_action_id')
    require(bool(re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', request_id)), 'invalid_request_id')
    require(bool(re.fullmatch(r'task-[a-zA-Z0-9_-]{1,100}', task_id)), 'invalid_task_id')
    folder = state / 'reconciled-actions' / action_id
    intent_path, done_path = folder / 'intent.json', folder / 'completed.json'
    prior = load(intent_path) if intent_path.exists() else None
    if prior:
        require((prior.get('actionId'), prior.get('requestId'), prior.get('taskId')) ==
                (action_id, request_id, task_id), 'reconciliation_identity_conflict')
    if done_path.exists():
        done = load(done_path)
        require(prior is not None and done.get('intentSha256') == hashlib.sha256(encoded(prior)).hexdigest(),
                'completed_proof_mismatch')
        return done | {'alreadyResolved': True}

    settings = load(state / 'settings.json')
    control = load(state / 'control.json')
    controller = load(state / 'controller.json')
    session = load(state / 'life-session.json')
    lease = load(state / 'lease.json')
    unknown_path = state / 'unknown.json'
    unknown = load(unknown_path) if unknown_path.exists() else (prior or {}).get('originalUnknown')
    require(isinstance(unknown, dict), 'unknown_missing_without_recovery_intent')
    require(control.get('enabled') is False and controller.get('status') == 'paused' and not controller.get('active'),
            'controller_not_paused_idle')
    require(not (state / 'inflight-action.json').exists(), 'another_action_in_flight')
    job = load(state / 'skill-job.json') if (state / 'skill-job.json').exists() else {}
    require(job.get('status') not in ('running', 'pending', 'dispatching'), 'skill_job_not_idle')
    require(unknown.get('schema') == 1 and unknown.get('result') == 'unknown'
            and unknown.get('actionId') == action_id and unknown.get('requestId') == request_id,
            'unknown_identity_mismatch')
    require(lease.get('schema') == 1 and lease.get('actionId') == action_id and lease.get('turnId') == unknown.get('turnId')
            and lease.get('actionLimit') == 6 and type(lease.get('actionsUsed')) is int
            and 1 <= lease['actionsUsed'] <= 6, 'lease_identity_mismatch')
    require(session.get('agentId') == 'qd-survivor' and session.get('bodyUuid') == settings.get('bodyUuid')
            and unknown['before'].get('bodyUuid') == settings.get('bodyUuid'), 'body_identity_mismatch')
    source_paths = {'ownedRequest': state / 'game-skill-requests' / (request_id + '.json'),
                    'worldRequest': queue / 'processing' / request_id / 'request.json',
                    'worldResult': queue / 'results' / (request_id + '.json')}
    sources = {k: load(p) for k, p in source_paths.items()}
    command = action_command(unknown['tool'], unknown['args'])
    owned, request, result = (sources[k] for k in ('ownedRequest', 'worldRequest', 'worldResult'))
    require(owned.get('requestId') == request_id and owned.get('actor') == settings.get('bodyName')
            and owned.get('actorUuid') == settings.get('bodyUuid') and owned.get('command') == command,
            'owned_request_mismatch')
    require(request.get('id') == request_id and request.get('actor') == owned['actor']
            and request.get('command') == command and request.get('submittedAt') == owned.get('submittedAt')
            and type(request.get('submittedAt')) is int and unknown['acceptedAt'] <= request['submittedAt'],
            'world_request_mismatch')
    require(result.get('requestId') == request_id and result.get('actor') == owned['actor']
            and result.get('ok') is False and result.get('code') == 'outcome_unknown' and result.get('skillId') == 'spring',
            'world_result_not_original_unknown')
    target = target_of(unknown)
    require(target['dimension'] == settings.get('dimension', 'minecraft:overworld'), 'wrong_original_dimension')
    if prior:
        require(unknown == prior.get('originalUnknown') and sources == prior.get('sources') and session == prior.get('session')
                and target == prior.get('target'), 'reconciliation_evidence_changed')
        old_lease = prior['originalLease']
    else:
        require(lease.get('status') == 'unknown', 'lease_not_unknown')
        old_lease = lease
    closed = old_lease | {'status': 'closed', 'reconciliation': {
        'actionId': action_id, 'requestId': request_id, 'status': 'resolved_effect_observed'}}
    require(lease in (old_lease, closed), 'lease_changed_during_recovery')
    status = backend.api('GET', '/agents/qd-survivor/agent-status')
    require(status.get('running_task_count') == 0, 'native_role_not_idle')
    if prior is None:
        actor, actor_uuid = gateway._check_binding()
        require((actor, actor_uuid) == (owned['actor'], owned['actorUuid']), 'live_body_binding_mismatch')
        body = gateway.snapshot()
        require(body.get('ok') is True and body.get('bodyUuid') == actor_uuid and body.get('bodyName') == actor
                and body.get('dimension') == target['dimension'] and body.get('hp', 0) > 0
                and body.get('task', {}).get('busy') is False, 'body_not_idle_available')
        native = native_proof(backend.poll(task_id), session, unknown)
        from world_actions import WorldActions
        observation = WorldActions(gateway).inspect(target['x'], target['y'], target['z'])
    else:
        # This is local commit recovery of already-fsynced proof, not a second
        # world observation. Native task caches can disappear on Qwen restart.
        native, observation = prior['nativeProof'], prior['observation']
        require(native.get('status') == 'finished' and native.get('resultStatus') in ('completed', 'failed', 'cancelled')
                and native.get('sessionId') == session['primarySessionId']
                and native.get('arguments') == unknown['args'] | {'turn_id': unknown['turnId']}
                and native.get('receipt', {}).get('actionId') == action_id
                and native.get('receipt', {}).get('ok') is False
                and native.get('receipt', {}).get('code') == 'outcome_unknown', 'archived_native_proof_invalid')
    require(observation.get('ok') is True and all(observation.get(k) == target[k] for k in ('x', 'y', 'z'))
            and observation.get('block') == 'minecraft:water' and observation.get('properties', {}).get('level') == '0',
            'source_water_not_observed')
    # Re-read control/native idle at the write boundary. No game or model POST exists in this tool.
    require(load(state / 'control.json') == control and not load(state / 'controller.json').get('active')
            and backend.api('GET', '/agents/qd-survivor/agent-status').get('running_task_count') == 0,
            'activity_changed_before_commit')
    preview = {'schema': 1, 'status': 'resolved_effect_observed', 'actionId': action_id, 'requestId': request_id,
               'taskId': task_id, 'target': target, 'originalOutcome': 'outcome_unknown',
               'targetBasis': 'derived_from_original_before_snapshot; command_time_location_was_not_archived',
               'effectAttributionVerified': False, 'manaChanged': False, 'learningChanged': False,
               'actionReplayed': False, 'controllerResumed': False, 'execute': execute}
    if not execute:
        return preview | {'observation': observation, 'nativeTaskVerified': True}
    if prior is None:
        prior = preview | {'originalUnknown': unknown, 'originalLease': old_lease, 'sources': sources,
                           'session': session, 'nativeProof': native, 'observation': observation,
                           'createdAt': int(time.time() * 1000)}
        folder.mkdir(parents=True, exist_ok=True)
        # Immutable intent, fsync before touching either blocker. Never overwrite an older proof.
        create_immutable(intent_path, prior)
    checkpoint('archived')
    require(load(state / 'lease.json') in (old_lease, closed), 'lease_changed_before_close')
    if unknown_path.exists():
        require(load(unknown_path) == unknown, 'unknown_changed_before_close')
    write_json(state / 'lease.json', closed)
    checkpoint('lease_closed')
    if unknown_path.exists():
        require(load(unknown_path) == unknown, 'unknown_changed_before_clear')
        unknown_path.unlink()
    checkpoint('unknown_cleared')
    done = preview | {'intentSha256': hashlib.sha256(encoded(prior)).hexdigest(), 'completedAt': int(time.time() * 1000)}
    write_json(done_path, done)
    return done


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('action-id', 'request-id', 'task-id'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--execute', choices=['qiandengji'])
    parser.add_argument('--inside-container', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not args.inside_container:
        # Exact existing supervised container; stream candidate code without changing its image/files.
        cmd = ['docker', 'exec', '-i', 'qiandengji-survivor-1', 'python', '-B', '-', '--inside-container',
               '--action-id', args.action_id, '--request-id', args.request_id, '--task-id', args.task_id]
        if args.execute:
            cmd += ['--execute', args.execute]
        result = subprocess.run(cmd, input=Path(__file__).read_bytes(), capture_output=True, timeout=120)
        sys.stdout.buffer.write(result.stdout)
        if result.returncode:
            sys.stderr.write('Reconciliation refused; no action was replayed.\n')
        return result.returncode
    sys.path.insert(0, '/survival')
    from numen_gateway import NumenGateway, action_lock
    from controller import QwenBackend
    state = Path('/state/survival')
    try:
        with action_lock(state):
            receipt = reconcile(state, Path(os.environ.get('SURVIVOR_SKILL_QUEUE', '/survival-skills-queue')),
                args.action_id, args.request_id, args.task_id, NumenGateway(state), QwenBackend(), execute=bool(args.execute))
        print(json.dumps(receipt, ensure_ascii=False))
        return 0
    except Exception as exc:
        # No raw HTTP/credential/body data in CLI errors.
        code = str(exc) if type(exc) is ValueError and re.fullmatch(r'[a-z_]+', str(exc)) else type(exc).__name__
        print(json.dumps({'ok': False, 'code': code, 'actionReplayed': False}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
