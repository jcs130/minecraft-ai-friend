"""Read-only live evidence for Kirito's persistent life session.

Run ``baseline --output runtime/survivor-life-before.json`` before enabling the
stopped controller, then ``collect --before runtime/survivor-life-before.json``.
No model POST, world command, lease write, goal change or service control exists
in this tool. Reports contain identifiers/counters/hashes, never conversation text.
Native task 404 is unknown evidence, not proof of completion or permission to retry.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from life_session import final_text
ROLE = 'qd-survivor'
DEFAULT_STATE = ROOT / 'server/survival-agent-state/survival'
SOURCE_FILES = ('tools/smoke_survivor_life.py', 'world/survival/controller.py',
                'world/survival/life_session.py', 'world/survival/numen_gateway.py',
                'world/survival/mcp_server.py', 'tests/test_survival_life_session.py')
TASK_ID = re.compile(r'[A-Za-z0-9_-]{1,128}\Z')
TURN_ID = re.compile(r'[A-Za-z0-9_-]{16,128}\Z')
ACTION_ID = re.compile(r'[0-9a-f]{32}\Z')
NATIVE_ACTIONS = {'goto', 'mine', 'craft', 'eat', 'equip_item'}
USAGE_FIELDS = ('modelRequests', 'promptTokens', 'completionTokens')


class EvidenceError(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise EvidenceError(code)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_json(path, limit=2 * 1024 * 1024):
    path = Path(path)
    require(not path.is_symlink() and path.is_file() and path.stat().st_size <= limit, 'invalid_evidence_file')
    try:
        return json.loads(path.read_text(encoding='utf-8-sig'))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise EvidenceError('invalid_evidence_json') from exc


def integer(value):
    return type(value) is int and value >= 0


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def source_hashes():
    return {name: digest(ROOT / name) for name in SOURCE_FILES}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise EvidenceError('native_redirect_rejected')


class NativeGet:
    """GET-only, fixed game runtime and role; no proxy or credential files."""
    def __init__(self, base_url='http://127.0.0.1:18089/api'):
        require(base_url.rstrip('/') in ('http://127.0.0.1:18089/api', 'http://localhost:18089/api'),
                'game_qwen_endpoint_required')
        self.base = base_url.rstrip('/')
        self.routes = []

    def __call__(self, route):
        require(route.startswith(('/chats?', '/token-usage/details?', '/console/chat/task/'))
                and not any(c in route for c in '\r\n\0'), 'unexpected_read_route')
        self.routes.append(route)
        req = urllib.request.Request(self.base + route, method='GET', headers={'X-Agent-Id': ROLE})
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        try:
            with opener.open(req, timeout=10) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
            require(len(raw) <= 2 * 1024 * 1024, 'native_response_too_large')
            return json.loads(raw)
        except urllib.error.HTTPError as exc:
            raise EvidenceError('native_http_' + str(exc.code)) from exc
        except (urllib.error.URLError, TimeoutError, OSError):
            raise EvidenceError('native_read_unavailable')


def usage(get):
    end = (datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat()
    rows = get('/token-usage/details?start_date=1970-01-01&end_date=' + end)
    require(isinstance(rows, list), 'native_usage_shape_invalid')
    result = dict.fromkeys(USAGE_FIELDS, 0)
    for row in rows:
        if not isinstance(row, dict) or row.get('agent_id') != ROLE:
            continue
        values = [row.get(k) for k in ('call_count', 'prompt_tokens', 'completion_tokens')]
        require(all(integer(v) for v in values), 'native_usage_counter_unknown')
        for key, value in zip(USAGE_FIELDS, values):
            result[key] += value
    return result


def decisions(controller):
    rows = controller.get('decisions')
    require(isinstance(rows, list), 'decision_ledger_invalid')
    result = []
    for row in rows:
        require(isinstance(row, dict) and isinstance(row.get('turnId'), str)
                and TURN_ID.fullmatch(row['turnId']) and number(row.get('startedAt')), 'decision_identity_invalid')
        result.append({'turnId': row['turnId'], 'startedAt': row['startedAt']})
    require(len({r['turnId'] for r in result}) == len(result), 'duplicate_decision_identity')
    return result


def baseline(state, get, clock=time.time):
    state = Path(state)
    controller = read_json(state / 'controller.json')
    settings = read_json(state / 'settings.json')
    require(controller.get('active') is None, 'baseline_requires_no_active_model_task')
    prior = decisions(controller)
    counters = usage(get)
    again = read_json(state / 'controller.json')
    require(again.get('active') is None and decisions(again) == prior, 'baseline_changed_during_read')
    timestamp = int(clock() * 1000)
    require(all(r['startedAt'] * 1000 <= timestamp for r in prior), 'baseline_clock_precedes_ledger')
    episodes = state / 'episodes.jsonl'
    session = read_json(state / 'life-session.json') if (state / 'life-session.json').exists() else None
    return {'schema': 1, 'kind': 'survivor-life-before', 'role': ROLE, 'observedAt': timestamp,
        'bodyUuid': settings.get('bodyUuid'), 'decisions': prior, 'usage': counters,
        'usageSource': 'native GET /token-usage/details filtered to qd-survivor',
        'primarySessionId': session.get('primarySessionId') if session else None,
        'episodesOffset': episodes.stat().st_size if episodes.exists() else 0,
        'controllerSha256': digest(state / 'controller.json'), 'sourceHashes': source_hashes(),
        'modelTasksSubmittedByProbe': 0, 'worldActionsByProbe': 0}


def validate_before(value):
    require(isinstance(value, dict) and value.get('schema') == 1
            and value.get('kind') == 'survivor-life-before' and value.get('role') == ROLE,
            'explicit_life_baseline_required')
    require(integer(value.get('observedAt')) and value['observedAt'] > 0, 'baseline_time_required')
    require(isinstance(value.get('bodyUuid'), str), 'baseline_body_required')
    decisions(value)
    require(isinstance(value.get('usage'), dict)
            and all(integer(value['usage'].get(k)) for k in USAGE_FIELDS), 'baseline_native_usage_required')
    require(integer(value.get('episodesOffset')), 'baseline_episode_offset_required')


def read_new_episodes(state, offset):
    path = Path(state) / 'episodes.jsonl'
    if not path.exists():
        require(offset == 0, 'episode_history_missing')
        return []
    require(not path.is_symlink() and path.stat().st_size >= offset, 'episode_history_truncated')
    with path.open('rb') as stream:
        stream.seek(offset)
        raw = stream.read(4 * 1024 * 1024 + 1)
    require(len(raw) <= 4 * 1024 * 1024, 'experiment_episode_window_too_large')
    rows = []
    # The currently appended, incomplete trailing line is not claimed as evidence.
    for line in raw.splitlines(keepends=True):
        if not line.endswith(b'\n'):
            continue
        try:
            row = json.loads(line)
        except (UnicodeError, ValueError):
            raise EvidenceError('episode_json_invalid')
        if isinstance(row, dict):
            rows.append(row)
    return rows


def task_map(controller, episodes, new_turns):
    found = {}
    for row in [*episodes, controller.get('active') or {}, controller.get('lastDecision') or {}]:
        turn = row.get('turnId')
        if turn not in new_turns or not row.get('taskId'):
            continue
        task = row['taskId']
        require(isinstance(task, str) and TASK_ID.fullmatch(task), 'native_task_id_invalid')
        require(turn not in found or found[turn] == task, 'turn_has_conflicting_native_tasks')
        found[turn] = task
    require(len(set(found.values())) == len(found), 'native_task_reused_across_turns')
    return found


def receipt_rows(state, turn, since, body_uuid):
    path = Path(state) / 'turn-actions' / (turn + '.json')
    if not path.exists():
        return []
    index = read_json(path)
    require(index.get('turnId') == turn and isinstance(index.get('actionIds'), list)
            and 1 <= len(index['actionIds']) <= 6, 'turn_action_index_invalid')
    require(len(set(index['actionIds'])) == len(index['actionIds']), 'duplicate_action_receipt')
    result = []
    for action in index['actionIds']:
        require(isinstance(action, str) and ACTION_ID.fullmatch(action), 'action_identity_invalid')
        file = Path(state) / 'action-receipts' / (action + '.json')
        if not file.exists():
            result.append({'actionId': action, 'turnId': turn, 'status': 'unknown', 'code': 'receipt_not_persisted'})
            continue
        row = read_json(file)
        require(row.get('schema') == 2 and row.get('actionId') == action and row.get('turnId') == turn,
                'action_receipt_binding_invalid')
        before, after = row.get('before') or {}, row.get('after') or {}
        result_value = row.get('result') if isinstance(row.get('result'), dict) else {}
        fresh = number(row.get('acceptedAt')) and row['acceptedAt'] >= since
        same_body = before.get('bodyUuid') == body_uuid and before.get('ok') is True
        observation = (after.get('ok') is True and after.get('bodyUuid') == body_uuid
                       and before.get('dimension') == after.get('dimension')
                       and isinstance(before.get('counts'), dict) and isinstance(after.get('counts'), dict))
        confirmed = row.get('completionConfirmed') is True
        navigation = row.get('navigationOutcome') or {}
        native_match = (row.get('tool') != 'goto' or
            (row.get('nativeTaskId') and navigation.get('task_id') == row['nativeTaskId']
             and before.get('navigationEpoch')
             and navigation.get('navigation_epoch') == before['navigationEpoch']
             and after.get('navigationEpoch') == before['navigationEpoch']))
        valid = bool(fresh and same_body and observation and row.get('tool') in NATIVE_ACTIONS
            and row.get('status') in ('completed', 'failed', 'observed_ended')
            and result_value.get('ok') is True and result_value.get('actionId') == action and native_match)
        result.append({'actionId': action, 'turnId': turn, 'tool': row.get('tool'),
            'status': row.get('status', 'unknown'), 'completionConfirmed': confirmed,
            'freshInExperiment': bool(fresh), 'bodyBindingVerified': same_body,
            'perActionBeforeAfter': observation, 'nativeTaskId': row.get('nativeTaskId'),
            'nativeNavigationMatched': bool(native_match), 'validNativeReceipt': valid,
            'nativeResultSuccess': navigation.get('success') if row.get('tool') == 'goto' else None,
            'receiptSha256': digest(file),
            'notice': 'Observed changes/idle are not a blanket goal-success assertion.'})
    return result


def collect(state, before, get, clock=time.time):
    validate_before(before)
    now = int(clock() * 1000)
    require(now >= before['observedAt'], 'experiment_clock_before_baseline')
    state = Path(state)
    controller, settings = read_json(state / 'controller.json'), read_json(state / 'settings.json')
    session = read_json(state / 'life-session.json') if (state / 'life-session.json').exists() else {}
    prior = {r['turnId'] for r in before['decisions']}
    current = decisions(controller)
    new = {r['turnId']: r for r in current
           if r['turnId'] not in prior and before['observedAt'] <= r['startedAt'] * 1000 <= now}
    identities = task_map(controller, read_new_episodes(state, before['episodesOffset']), new)
    checks, errors = [], []
    def check(name, passed, evidence, level='live-read-only', required=True):
        checks.append({'name': name, 'ok': bool(passed), 'required': required,
                       'evidenceLevel': level, 'evidence': evidence})
    body_uuid = settings.get('bodyUuid')
    binding = (session.get('schema') == 1 and session.get('agentId') == ROLE
        and session.get('bodyUuid') == body_uuid == before['bodyUuid']
        and session.get('userId') == 'survival-controller' and session.get('channel') == 'console'
        and isinstance(session.get('primarySessionId'), str)
        and (before.get('primarySessionId') in (None, session.get('primarySessionId'))))
    native_chat = None
    try:
        chats = get('/chats?' + urllib.parse.urlencode({'user_id': 'survival-controller', 'channel': 'console'}))
        require(isinstance(chats, list), 'native_chat_list_invalid')
        matches = [r for r in chats if isinstance(r, dict)
            and (r.get('session_id'), r.get('user_id'), r.get('channel')) ==
                (session.get('primarySessionId'), 'survival-controller', 'console')]
        if len(matches) == 1 and session.get('chatId') in (None, matches[0].get('id')):
            native_chat = {k: matches[0].get(k) for k in ('id', 'session_id', 'user_id', 'channel', 'status')}
    except EvidenceError as exc:
        errors.append({'operation': 'native_chats', 'code': str(exc)})
    tasks = []
    for turn, reservation in new.items():
        task_id = identities.get(turn)
        row = {'turnId': turn, 'taskId': task_id, 'startedAt': reservation['startedAt'],
               'nativeSessionVerified': False, 'nativeAnswerVerified': False, 'nativeStatus': 'unknown'}
        if task_id:
            try:
                native = get('/console/chat/task/' + task_id)
                require(isinstance(native, dict), 'native_task_shape_invalid')
                result = native.get('result') if isinstance(native.get('result'), dict) else {}
                row.update(nativeStatus=native.get('status', 'unknown'), resultStatus=result.get('status'),
                    nativeAnswerVerified=bool(native.get('status') in ('finished', 'completed') and final_text(result)),
                    nativeSessionId=result.get('session_id'),
                    nativeSessionVerified=bool(binding and native_chat
                        and native.get('status') in ('finished', 'completed')
                        and result.get('status') == 'completed'
                        and result.get('session_id') == session.get('primarySessionId')))
            except EvidenceError as exc:
                row['error'] = str(exc)
        else:
            row['error'] = 'native_submission_id_unknown'
        tasks.append(row)
    verified = {r['turnId'] for r in tasks if r['nativeSessionVerified'] and r['nativeAnswerVerified']}
    bound_turns = {r['turnId'] for r in tasks if r['nativeSessionVerified']}
    receipts = [r for turn in new for r in receipt_rows(state, turn, before['observedAt'], body_uuid)]
    # Real game actions and cost remain evidence even when the model hit its limit.
    valid_receipts = [r for r in receipts if r['turnId'] in bound_turns and r.get('validNativeReceipt')]
    unknown = ([{'turnId': r['turnId'], 'taskId': r['taskId'], 'code': r.get('error', 'native_task_unknown')}
                for r in tasks if r['nativeStatus'] == 'unknown']
               + [{'turnId': r['turnId'], 'actionId': r['actionId'], 'code': 'action_outcome_unknown'}
                  for r in receipts if r['status'] == 'unknown'])
    if (state / 'unknown.json').exists():
        marker = read_json(state / 'unknown.json')
        unknown.append({k: marker.get(k) for k in ('turnId', 'actionId', 'tool')}
                       | {'code': 'live_unknown_marker_present'})
    after_usage, delta = None, None
    try:
        after_usage = usage(get)
        delta = {k: after_usage[k] - before['usage'][k] for k in USAGE_FIELDS}
        require(all(v >= 0 for v in delta.values()), 'native_usage_counter_went_backwards')
    except EvidenceError as exc:
        errors.append({'operation': 'native_usage', 'code': str(exc)})
        delta = None
    check('explicit-new-run-window', not bool(prior & set(new)),
          {'since': before['observedAt'], 'oldTurnCount': len(prior), 'newTurnCount': len(new),
           'excludedPreBaselineTurns': len(current) - len(new)})
    check('persistent-native-session', binding and native_chat is not None and len(verified) >= 2,
          {'verifiedDistinctNativeTasks': len(verified), 'required': 2, 'chat': native_chat})
    check('per-action-native-body-receipt', len(valid_receipts) >= 1,
          {'verifiedReceipts': len(valid_receipts), 'required': 1})
    check('unknown-outcomes-not-assumed', not unknown, {'unknown': unknown})
    check('native-model-usage-delta', delta is not None and delta['modelRequests'] > 0,
          {'before': before['usage'], 'after': after_usage, 'delta': delta,
           'attribution': 'qd-survivor native aggregate within this time window; concurrent calls to the same role cannot be excluded.'})
    check('same-session-after-live-restart', False,
          {'status': 'not_exercised', 'notice': 'No live restart requested. Separate offline native storage/controller fixtures are not live restart evidence.',
           'fixtureSource': 'tests/test_survival_life_session.py'}, level='not-performed', required=False)
    return {'schema': 1, 'kind': 'survivor-life-smoke', 'role': ROLE, 'observedAt': now,
        'ok': all(r['ok'] for r in checks if r['required']), 'checks': checks,
        'window': {'startedAt': before['observedAt'], 'endedAt': now},
        'session': {k: session.get(k) for k in ('primarySessionId', 'agentId', 'bodyUuid', 'userId', 'channel', 'chatId')},
        'tasks': tasks, 'actionReceipts': receipts, 'readErrors': errors,
        'controller': {'status': controller.get('status'), 'pauseReason': controller.get('pauseReason'),
                       'activeTaskId': (controller.get('active') or {}).get('taskId')},
        'configuredBudget': {
            'dailyPlanningLimit': settings.get('dailyPlanningLimit', settings.get('decisionsPerDay')),
            'decisionCooldownSeconds': settings.get('decisionCooldownSeconds'),
            'inferenceLimitPolicy': ('unrestricted' if settings.get('dailyPlanningLimit',
                settings.get('decisionsPerDay')) is None else 'bounded')},
        'sourceHashes': source_hashes(), 'modelTasksSubmittedByProbe': 0, 'worldActionsByProbe': 0,
        'productionFilesChangedByProbe': 0,
        'limitations': ['No physical gameplay claim beyond the recorded receipts.',
                        'The probe does not test compression, restart the model service, or replay missing tasks.']}


def save_report(path, value):
    path = Path(path).resolve()
    require(any(path.is_relative_to(ROOT / folder) for folder in ('runtime', 'reports')),
            'output_must_be_in_reports_or_runtime')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('baseline', 'collect'))
    parser.add_argument('--state', type=Path, default=DEFAULT_STATE)
    parser.add_argument('--api-url', default='http://127.0.0.1:18089/api')
    parser.add_argument('--before', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    output = args.output or ROOT / ('runtime/survivor-life-before.json' if args.mode == 'baseline'
                                   else 'reports/survivor-life-smoke.json')
    try:
        get = NativeGet(args.api_url)
        if args.mode == 'baseline':
            report = baseline(args.state, get)
        else:
            require(args.before is not None, 'explicit_before_file_required')
            before = read_json(args.before)
            report = collect(args.state, before, get)
            report['baselineSha256'] = digest(args.before)
        report['nativeGetRequests'] = len(get.routes)
        save_report(output, report)
        print(json.dumps({'ok': report.get('ok', True), 'mode': args.mode,
                          'report': str(output.resolve()), 'nativeGetRequests': len(get.routes),
                          'modelTasksSubmittedByProbe': 0, 'worldActionsByProbe': 0}))
        return 0 if report.get('ok', True) else 2
    except (EvidenceError, OSError, TypeError, KeyError) as exc:
        code = str(exc) if isinstance(exc, EvidenceError) else type(exc).__name__
        print(json.dumps({'ok': False, 'code': code, 'modelTasksSubmittedByProbe': 0, 'worldActionsByProbe': 0}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
