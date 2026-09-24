"""Bounded receipt evidence for the next already-due cognition turn.

No wake, model request, body command, retry, cancellation, or goal-success claim.
Only distinct, owned terminal actions count; an idle body is not itself evidence.
"""
import copy
import hashlib
import json
import math
import re

WINDOW_SECONDS = 600
MAX_NEW_RECEIPTS = 6
MAX_SEEN = 64
THRESHOLD = 3
TERMINAL = frozenset(('completed', 'failed', 'cancelled', 'dispatched'))
NOTICE = ('这些是同一目标下不同动作的已确认回执，不是目标完成判断。'
          '核对失败条件或无可见效果的原因，再自主决定调整方法、等待条件或下一目标；'
          '失败可能已有部分效果，不要求重试。不得重复未知/在途动作，也不为此打断正常工作或休息。')


def _dict(value):
    return value if isinstance(value, dict) else {}


def _number(value):
    return type(value) in (int, float) and math.isfinite(value)


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True,
                                    allow_nan=False, separators=(',', ':')).encode()).hexdigest()


def _distance(before, after):
    a, b = _dict(before.get('position')), _dict(after.get('position'))
    if not all(_number(point.get(axis)) for point in (a, b) for axis in ('x', 'y', 'z')):
        return None
    return math.sqrt(sum((a[axis] - b[axis]) ** 2 for axis in ('x', 'y', 'z')))


def _evidence(row, raw, scope, now):
    """Missing/partial facts never establish absence of an effect."""
    receipt, command = _dict(row.get('receipt')), _dict(row.get('command') or row.get('payload'))
    tool, args = raw.get('tool'), raw.get('args')
    before, after = _dict(raw.get('before')), _dict(raw.get('after'))
    if (raw.get('actionId') != receipt.get('actionId') or raw.get('turnId') != row.get('motorTurnId')
            or not tool or tool != command.get('tool') or not isinstance(args, dict)
            or before.get('bodyUuid') != scope.get('bodyUuid')):
        return None
    if row.get('payloadHash'):
        if _digest({'tool': tool, 'args': args}) != row['payloadHash']:
            return None
    elif command.get('argsTruncated') or command.get('args') != args:
        return None
    stamp = after.get('observedAt', raw.get('observedAt', raw.get('acceptedAt')))
    if not _number(stamp) or not 0 <= now - stamp / 1000 <= WINDOW_SECONDS:
        return None
    native = _dict(_dict(raw.get('result')).get('result'))
    result = _dict(raw.get('result'))
    code = (_dict(receipt.get('gameSkill')).get('code')
            or _dict(raw.get('navigationOutcome')).get('reason')
            or _dict(_dict(native.get('data')).get('receipt')).get('code')
            or result.get('code'))
    if (row.get('status') == 'failed' and isinstance(code, str) and code
            and (raw.get('status') == 'failed' and raw.get('completionConfirmed') is True
                 or raw.get('status') == 'rejected' and result.get('ok') is False)):
        return {'kind': 'repeated_native_failure', 'code': code[:120], 'tool': tool,
                'evidence': 'distinct_owned_terminal_failure', 'key': _digest([tool, args, code]),
                'requestId': row['requestId'], 'actionId': raw['actionId']}
    if (row.get('status') != 'completed' or raw.get('status') != 'completed'
            or raw.get('completionConfirmed') is not True or before.get('ok') is not True
            or after.get('ok') is not True or after.get('bodyUuid') != scope.get('bodyUuid')
            or not before.get('dimension') or before.get('dimension') != after.get('dimension')):
        return None
    distance = _distance(before, after)
    if tool == 'goto' and distance is not None and distance <= .05:
        evidence = 'confirmed_goto_same_position'
    elif (tool == 'eat' and isinstance(before.get('counts'), dict) and before['counts'] == after.get('counts')
          and all(_number(before.get(k)) and before[k] == after.get(k) for k in ('hp', 'hunger'))):
        evidence = 'confirmed_eat_same_inventory_and_vitals'
    else:
        # Movement or changed observations only break a no-effect sequence. They
        # do not prove this goal advanced; unsupported effects remain unknown.
        return None
    return {'kind': 'repeated_no_observed_effect', 'code': 'no_observed_effect', 'tool': tool,
            'evidence': evidence, 'key': _digest([tool, args, evidence]),
            'requestId': row['requestId'], 'actionId': raw['actionId']}


def update(previous, *, scope, goal_state, rows, body, now, load_receipt):
    """Pure state update except for at most six exact-ID receipt reads supplied by caller."""
    rows = [r for r in rows[-40:] if isinstance(r, dict) and isinstance(r.get('requestId'), str)]
    identity = _digest(scope)
    state = copy.deepcopy(previous) if isinstance(previous, dict) else {}
    if state.get('binding') != identity:
        # A new goal/life or first deployment starts observing here, not by
        # attributing previously queued work to a newly stated intention.
        return {'version': 1, 'binding': identity, 'seen': [r['requestId'] for r in rows], 'run': None}, None
    seen = list(state.get('seen', []))[-MAX_SEEN:]
    run = state.get('run')
    if not isinstance(run, dict) or not _number(run.get('lastAt')) or now - run['lastAt'] > WINDOW_SECONDS:
        run = None
    if goal_state not in ('ongoing', 'blocked', ''):
        state.update(seen=list(dict.fromkeys(seen + [r['requestId'] for r in rows]))[-MAX_SEEN:], run=None)
        return state, None
    reads = 0
    for row in rows:
        if row['requestId'] in seen or row.get('status') not in TERMINAL:
            continue
        if reads >= MAX_NEW_RECEIPTS:
            break
        seen.append(row['requestId'])
        receipt = _dict(row.get('receipt'))
        action_id = receipt.get('actionId')
        finding = None
        if (row.get('kind') == 'action' and row.get('status') in ('completed', 'failed')
                and isinstance(action_id, str) and re.fullmatch(r'[0-9a-f]{32}', action_id)):
            reads += 1
            try:
                finding = _evidence(row, _dict(load_receipt(action_id)), scope, now)
            except (OSError, ValueError, KeyError, TypeError):
                pass
        if finding is None:
            run = None
            continue
        if not run or run.get('key') != finding['key']:
            run = {**finding, 'count': 0, 'requestIds': [], 'actionIds': []}
        run.update(count=min(64, run['count'] + 1), lastAt=now,
                   requestIds=(run['requestIds'] + [finding['requestId']])[-3:],
                   actionIds=(run['actionIds'] + [finding['actionId']])[-3:])
    state.update(seen=seen[-MAX_SEEN:], run=run)
    busy = (_dict(body.get('task')).get('busy') is True or body.get('sleeping') is True
            or any(r.get('status') in ('queued', 'claimed', 'unknown') for r in rows))
    if busy or not run or run['count'] < THRESHOLD:
        return state, None
    hint = {k: run[k] for k in ('kind', 'code', 'tool', 'evidence', 'count', 'requestIds', 'actionIds')}
    hint.update(goalSuccessInferred=False, retryAutomatically=False, instruction=NOTICE)
    return state, hint


def observe(controller, body, control):
    """Read the bounded queue, then only unseen terminal receipts; never scan the archive."""
    from motor_mailbox import view
    from numen_gateway import _read_json
    try:
        memory = controller.memory()
        scope = {'goal': memory.get('goal') or control.get('mission'),
                 'missionChangedAt': control.get('missionChangedAt'),
                 'goalAgendaSelection': control.get('goalAgendaSelection'),
                 'bodyUuid': body.get('bodyUuid'), 'dimension': body.get('dimension'),
                 'life': controller.session.get('primarySessionId'),
                 'bodyEpisode': controller.session.get('bodyEpisode'),
                 'memoryEpoch': controller.settings.get('memoryEpoch')}
        state, hint = update(controller.data.get('motorProgressAudit'), scope=scope,
            goal_state=str(memory.get('goalState') or '').lower(), rows=view(controller.root)['requests'],
            body=body, now=controller.clock(),
            load_receipt=lambda aid: _read_json(controller.root / 'action-receipts' / (aid + '.json'), 512 * 1024))
        controller.data['motorProgressAudit'] = state
        controller.data.pop('motorProgressAuditError', None)
        return hint
    except (OSError, ValueError, TypeError, KeyError) as error:
        controller.data['motorProgressAuditError'] = type(error).__name__
        return None
