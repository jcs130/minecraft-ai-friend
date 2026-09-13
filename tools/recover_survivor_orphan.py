"""Archive a lost Qwen process task while survivor is stopped; never resume/replay.

Preview is read-only. --apply requires the exact task ID, a stopped Compose
survivor, a newer live Qwen container, its exact native 404 and an idle role.
Only controller.json changes; original bytes and evidence are archived first.
"""
from __future__ import annotations

import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from numen_gateway import write_json


class RecoveryError(ValueError):
    pass


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def checked(value, code):
    if not value:
        raise RecoveryError(code)


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


class DockerRuntime:
    def __init__(self, survivor='qiandengji-survivor-1', qwen='qiandengji-qwenpaw-1'):
        self.survivor, self.qwen = survivor, qwen

    @staticmethod
    def run(*args):
        result = subprocess.run(['docker', *args], capture_output=True, text=True,
                                encoding='utf-8', timeout=40, check=False)
        checked(result.returncode == 0, 'docker_read_failed')
        return json.loads(result.stdout)

    def inspect(self, target):
        # Do not collect Config.Env: it may contain credentials.
        template = ('{"id":{{json .Id}},"running":{{json .State.Running}},'
                    '"status":{{json .State.Status}},"startedAt":{{json .State.StartedAt}},'
                    '"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
                    '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
                    '"mounts":{{json .Mounts}}}')
        value = self.run('inspect', '--format', template, target)
        value['stateMount'] = next((m['Source'] for m in value.pop('mounts')
                                   if m['Destination'] == '/state' and m['Type'] == 'bind'), None)
        return value

    def collect(self, task_id):
        before = {k: self.inspect(v) for k, v in
                  (('survivor', self.survivor), ('qwen', self.qwen))}
        checked(before['qwen']['running'] is True, 'qwen_not_running')
        # argv is passed directly, not through a shell. Only GETs are made.
        script = '''import hashlib,json,pathlib,sys,sysconfig,urllib.request,urllib.error
task=sys.argv[1]
base='http://127.0.0.1:8088/api'
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def get(path):
    req=urllib.request.Request(base+path,headers={'X-Agent-Id':'qd-survivor'})
    try:
        with opener.open(req,timeout=15) as response:
            return response.status,json.loads(response.read(1048577))
    except urllib.error.HTTPError as response:
        return response.code,json.loads(response.read(1048577))
code,body=get('/console/chat/task/'+task)
role_code,role=get('/agents/qd-survivor/agent-status')
source=pathlib.Path(sysconfig.get_path('purelib'))/'qwenpaw/app/routers/console.py'
raw=source.read_bytes()
text=raw.decode('utf-8')
volatile=all(s in text for s in ('_bg_tasks: Dict[str, _BackgroundTask] = {}',
    'bg = _bg_tasks.get(task_id)', 'asyncio.create_task(_run())'))
print(json.dumps({'taskId':task,'httpStatus':code,
    'exactTaskMissing':code==404 and body.get('detail')=='Task not found: '+task,
    'agentId':'qd-survivor','roleHttpStatus':role_code,'roleStatus':role,
    'volatileTaskStoreVerified':volatile,'consoleSourceSha256':hashlib.sha256(raw).hexdigest()}))
'''
        native = self.run('exec', before['qwen']['id'], 'python', '-c', script, task_id)
        after = {k: self.inspect(v) for k, v in
                 (('survivor', self.survivor), ('qwen', self.qwen))}
        checked(before == after, 'runtime_changed_during_observation')
        return {**after, 'native': native, 'observedAt': time.time()}


def snapshot(state):
    files = {}
    names = ['controller.json', 'control.json', 'life-session.json', 'lease.json', 'settings.json']
    names += [p for p in ('skill-job.json', 'perception.json', 'last-action.json') if (state / p).exists()]
    def read(name):
        path = state / name
        checked(not path.is_symlink() and path.resolve().is_relative_to(state.resolve()), 'unsafe_state_path')
        raw = path.read_bytes()
        checked(len(raw) <= 2 * 1024 * 1024, 'state_file_too_large')
        files[name] = raw
        value = json.loads(raw.decode('utf-8-sig'))
        checked(isinstance(value, dict), 'state_file_not_object')
        return value
    values = {n: read(n) for n in names}
    last_action = values.get('last-action.json', {}).get('actionId')
    if last_action:
        checked(isinstance(last_action, str) and re.fullmatch(r'[0-9a-f]{32}', last_action), 'invalid_last_action_id')
        values['lastReceipt'] = read('action-receipts/' + last_action + '.json')
        checked(values['lastReceipt'].get('actionId') == last_action, 'last_receipt_identity_mismatch')
    active = values['controller.json'].get('active')
    if active:
        turn = active.get('turnId')
        checked(isinstance(turn, str) and re.fullmatch(r'survival-[0-9a-f]{32}', turn), 'invalid_turn_id')
        index_name = 'turn-actions/' + turn + '.json'
        if (state / index_name).exists():
            index = read(index_name)
            checked(index.get('turnId') == turn, 'turn_index_identity_mismatch')
            ids = index.get('actionIds')
            checked(isinstance(ids, list) and len(ids) <= 6 and len(set(ids)) == len(ids), 'turn_index_invalid')
            receipts = []
            for action in ids:
                checked(isinstance(action, str) and re.fullmatch(r'[0-9a-f]{32}', action), 'invalid_action_id')
                receipt = read('action-receipts/' + action + '.json')
                checked(receipt.get('actionId') == action and receipt.get('turnId') == turn,
                        'receipt_identity_mismatch')
                receipts.append(receipt)
            values['receipts'] = receipts
        else:
            values['receipts'] = []
    values['markers'] = [p for p in ('unknown.json', 'inflight-action.json') if (state / p).exists()]
    return values, files


def validate(state, task_id, values, evidence, now, *, apply):
    data, control = values['controller.json'], values['control.json']
    active, lease, session = data.get('active'), values['lease.json'], values['life-session.json']
    checked(isinstance(active, dict) and active.get('taskId') == task_id, 'active_task_mismatch')
    checked(active.get('phase') == 'submitted' and not active.get('nativeTerminal'), 'not_an_orphan_submission')
    checked(control.get('enabled') is False and data.get('status') in ('paused', 'stopped'), 'survivor_must_be_paused')
    checked(not active.get('partyReservation'), 'party_delivery_requires_separate_reconciliation')
    checked(session.get('agentId') == 'qd-survivor'
            and session.get('bodyUuid') == values['settings.json'].get('bodyUuid'), 'session_binding_mismatch')
    for field, bound in (('sessionId', 'primarySessionId'), ('chatId', 'chatId'),
                         ('userId', 'userId'), ('channel', 'channel')):
        checked(active.get(field) is not None and active.get(field) == session.get(bound), 'active_session_mismatch')
    checked(not values['markers'], 'unresolved_action_marker')
    checked(not data.get('observeAction') and data.get('actionExecution', {}).get('inFlight') is False
            and data.get('actionExecution', {}).get('ok') is True, 'action_execution_not_settled')
    job = values.get('skill-job.json', {})
    checked(not job or job.get('status') in ('done', 'failed', 'cancelled', 'replan'), 'skill_job_not_settled')
    checked(lease.get('turnId') == active['turnId'] and lease.get('status') == 'closed'
            and type(lease.get('expiresAt')) in (int, float) and lease['expiresAt'] < now * 1000,
            'old_lease_not_closed_and_expired')
    receipts = values['receipts']
    checked(type(lease.get('actionsUsed')) is int and lease['actionsUsed'] == len(receipts), 'receipt_count_mismatch')
    checked(all(r.get('status') in ('completed', 'failed', 'rejected', 'observed_ended', 'resolved_effect_observed')
                for r in receipts + ([values['lastReceipt']] if values.get('lastReceipt') else [])),
            'action_receipt_not_settled')
    for key, service in (('survivor', 'survivor'), ('qwen', 'qwenpaw')):
        runtime = evidence[key]
        checked(runtime.get('project') == 'qiandengji' and runtime.get('service') == service, 'wrong_compose_runtime')
    survivor, qwen, native = evidence['survivor'], evidence['qwen'], evidence['native']
    checked(Path(survivor.get('stateMount', '')).resolve() == state.parent.resolve(), 'state_mount_mismatch')
    if apply:
        checked(survivor.get('running') is False and survivor.get('status') == 'exited', 'stop_survivor_before_apply')
    started = active.get('startedAt')
    checked(type(started) in (int, float) and math.isfinite(started)
            and started < timestamp(qwen['startedAt']) <= now and qwen.get('running') is True,
            'qwen_restart_after_submission_not_proven')
    checked(native.get('taskId') == task_id and native.get('httpStatus') == 404
            and native.get('exactTaskMissing') is True and native.get('volatileTaskStoreVerified') is True,
            'native_process_task_loss_not_proven')
    role = native.get('roleStatus', {})
    checked(native.get('agentId') == 'qd-survivor' and native.get('roleHttpStatus') == 200
            and role.get('status') == 'idle' and role.get('running_task_count') == 0, 'survivor_native_role_not_idle')
    checked(0 <= now - evidence['observedAt'] <= 60, 'runtime_evidence_stale')


def recover(state, task_id, runtime, *, apply=False, clock=time.time):
    state = Path(state).resolve()
    checked(re.fullmatch(r'task-[0-9a-f]{12}', task_id), 'invalid_task_id')
    values, files = snapshot(state)
    prior = values['controller.json'].get('orphanRecovery', {})
    if values['controller.json'].get('active') is None and prior.get('taskId') == task_id:
        receipt = state / prior['archive'] / 'recovery.json'
        checked(receipt.is_file(), 'recovery_archive_missing')
        return {'applied': False, 'alreadyApplied': True, **prior}
    evidence = runtime.collect(task_id)
    validate(state, task_id, values, evidence, clock(), apply=apply)
    active = values['controller.json']['active']
    plan = {'taskId': task_id, 'turnId': active['turnId'], 'sessionId': active['sessionId'],
            'chatId': active['chatId'], 'actionCount': len(values['receipts']),
            'nativeTaskCompleted': None, 'enabled': False, 'evidence': evidence, 'applied': False}
    if not apply:
        return {**plan, 'preview': True, 'stopRequired': evidence['survivor']['running'] is not False}
    archive = 'orphaned-tasks/' + task_id + '-' + uuid.uuid4().hex[:12]
    row = {'at': datetime.fromtimestamp(clock(), timezone.utc).isoformat(),
           'kind': 'decision_interrupted', 'reason': 'native_runtime_restarted_result_unavailable',
           'taskId': task_id, 'turnId': active['turnId'], 'sessionId': active['sessionId'],
           'chatId': active['chatId'], 'nativeTaskCompleted': None, 'archive': archive,
           'notice': 'Old process ended; its final model outcome remains unverified. No action replayed.'}
    updated = copy.deepcopy(values['controller.json'])
    updated.update(active=None, status='paused', cancellationStatus='native_runtime_interrupted',
                   orphanRecovery=row, lastDecisionSignature=None)
    # Preserve previous lastDecision, counters, original lease, review/event watermarks,
    # party replies and life-session bytes. New observations follow ordinary resume.
    updated['episodes'] = (updated.get('episodes', []) + [row])[-16:]
    destination = state / archive
    destination.mkdir(parents=True, exist_ok=False)
    for name, raw in files.items():
        path = destination / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('xb') as stream:
            stream.write(raw)
            stream.flush()
            import os
            os.fsync(stream.fileno())
    write_json(destination / 'recovery.json', {'schema': 1, **{k: v for k, v in plan.items() if k != 'applied'},
               'phase': 'prepared', 'record': row,
               'sourceSha256': {name: digest(raw) for name, raw in files.items()},
               'controllerAfter': updated})
    # Recheck live identity/idle status after the archive is durable, then compare
    # exact state bytes. A running controller is never protected by a host lock.
    current_evidence = runtime.collect(task_id)
    current, current_files = snapshot(state)
    validate(state, task_id, current, current_evidence, clock(), apply=True)
    checked(current_files == files and evidence['survivor'] == current_evidence['survivor']
            and evidence['qwen'] == current_evidence['qwen'], 'state_or_runtime_changed_before_apply')
    write_json(state / 'controller.json', updated)
    readback = (state / 'controller.json').read_bytes()
    checked(json.loads(readback.decode('utf-8-sig')) == updated, 'controller_readback_mismatch')
    write_json(destination / 'applied.json', {'schema': 1, 'phase': 'applied', 'taskId': task_id,
               'turnId': active['turnId'], 'at': datetime.fromtimestamp(clock(), timezone.utc).isoformat(),
               'controllerSha256': digest(readback), 'finalRuntimeEvidence': current_evidence})
    return {**plan, 'applied': True, 'archive': str(destination), 'resumeRequired': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--task-id', required=True)
    parser.add_argument('--state', type=Path, default=ROOT / 'server/survival-agent-state/survival')
    parser.add_argument('--survivor-container', default='qiandengji-survivor-1')
    parser.add_argument('--qwen-container', default='qiandengji-qwenpaw-1')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        result = recover(args.state, args.task_id, DockerRuntime(args.survivor_container, args.qwen_container),
                         apply=args.apply)
    except (RecoveryError, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        print(json.dumps({'ok': False, 'code': str(exc) if isinstance(exc, RecoveryError) else type(exc).__name__}))
        return 1
    print(json.dumps({'ok': True, **result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
