"""Step1a action-side trajectory reader for the survivor state directory.

Normalizes the durable action evidence written by world/survival/numen_gateway.py
(action-receipts/<actionId>.json, actions.jsonl) and world/survival/controller.py
(episodes.jsonl) into transition rows, turn rows and a data-card summary for the
offline survival dataset (case-638934f646fe2ffeebfe, Step1a). The schemas below
were read directly from that source: a receipt carries schema/actionId/turnId/
tool/args/acceptedAt/result/status/completionConfirmed and, once settled,
after/observedAt (+nativeTaskId/navigationOutcome/notice); result is the string
'unknown' on the crash-safe marker form. episode rows are {'at': iso-utc,
'kind': ..., **values} with action_observed/action_response (legacy rows lack
actionId/turnId), decision_finished and skill_* kinds.

Placement: tests/ is the only tree the fixed engineering plan covers for new
files; this is an offline analysis module and production services must never
import it. The intended home world/ops/survival_trajectory.py follows the
pending coverage expansion. Pure stdlib, read-only, no network, no game action.
"""
import json
import math
import re
from datetime import datetime
from pathlib import Path

RECEIPT_NAME = re.compile(r'^[0-9a-f]{32}\.json$')
SETTLED_STATUSES = ('completed', 'rejected', 'failed', 'observed_ended', 'effect_unconfirmed')
SNAPSHOT_KEYS = ('ok', 'bodyUuid', 'position', 'dimension', 'counts', 'hp', 'hunger',
                 'task', 'navigationEpoch', 'navigationResult', 'observedAt')
SKILL_KINDS = ('skill_finished', 'skill_stopped', 'skill_error')
MAX_RECEIPT_BYTES = 1 << 20
MAX_LINE_BYTES = 1 << 20


def _number(value):
    return type(value) in (int, float) and math.isfinite(value)


def _stamp(value):
    return value if _number(value) else 0


def _compact_snapshot(snapshot):
    if not isinstance(snapshot, dict):
        return None
    return {key: snapshot[key] for key in SNAPSHOT_KEYS if key in snapshot}


def inventory_delta(before, after):
    """Same semantics as controller.delta: only changed items; an item missing
    after the action counts as fully lost, never as zero."""
    if not isinstance(before, dict) or not isinstance(after, dict):
        return {}  # a missing snapshot is missing evidence, not a full haul
    before_counts, after_counts = before.get('counts', {}), after.get('counts', {})
    if not isinstance(before_counts, dict) or not isinstance(after_counts, dict):
        return {}
    result = {item: count - before_counts.get(item, 0)
              for item, count in after_counts.items() if count != before_counts.get(item, 0)}
    for item, count in before_counts.items():
        if item not in after_counts:
            result[item] = -count
    return result


def displacement(before, after):
    """Horizontal x/z blocks travelled plus the y change; None when either
    position is missing, because absence of evidence is not a stationary body."""
    start = before.get('position') if isinstance(before, dict) else None
    end = after.get('position') if isinstance(after, dict) else None
    if not isinstance(start, dict) or not isinstance(end, dict):
        return None
    if not all(_number(point.get(axis)) for point in (start, end) for axis in ('x', 'y', 'z')):
        return None
    return {'horizontal': math.hypot(end['x'] - start['x'], end['z'] - start['z']),
            'dy': end['y'] - start['y']}


def _navigation_success(receipt):
    outcome = receipt.get('navigationOutcome')
    if isinstance(outcome, dict) and type(outcome.get('success')) is bool:
        return outcome['success']
    return None


def load_receipts(state_dir):
    """Every well-formed action receipt, oldest first. Non-receipt file names
    are ignored; receipt files that do not conform are reported, not guessed."""
    folder = Path(state_dir) / 'action-receipts'
    if not folder.is_dir():
        return {'receipts': [], 'invalid': [], 'ignoredFiles': 0}
    receipts, invalid, ignored = [], [], 0
    for path in sorted(folder.iterdir()):
        if not RECEIPT_NAME.match(path.name):
            ignored += 1
            continue
        try:
            if path.stat().st_size > MAX_RECEIPT_BYTES:
                raise ValueError('receipt_too_large')
            receipt = json.loads(path.read_text(encoding='utf-8'))
            if (not isinstance(receipt, dict) or receipt.get('schema') != 2
                    or receipt.get('actionId') != path.name[:-5]
                    or not isinstance(receipt.get('turnId'), str)
                    or not isinstance(receipt.get('tool'), str)):
                raise ValueError('receipt_schema_invalid')
        except (OSError, ValueError):
            invalid.append({'file': path.name, 'reason': 'unreadable_or_invalid'})
            continue
        receipts.append(receipt)
    receipts.sort(key=lambda row: (_stamp(row.get('acceptedAt')), row.get('actionId') or ''))
    return {'receipts': receipts, 'invalid': invalid, 'ignoredFiles': ignored}


def load_jsonl(path):
    """Stream one append-only jsonl file; malformed lines are counted, never
    reconstructed, so a torn write stays visible in the data card."""
    rows, malformed = [], 0
    path = Path(path)
    if not path.exists():
        return {'rows': rows, 'malformed': malformed}
    with path.open('r', encoding='utf-8', errors='replace') as stream:
        for line in stream:
            text = line.strip()
            if not text:
                continue
            if len(text.encode('utf-8', errors='replace')) > MAX_LINE_BYTES:
                malformed += 1
                continue
            try:
                value = json.loads(text)
            except ValueError:
                malformed += 1
                continue
            if isinstance(value, dict):
                rows.append(value)
            else:
                malformed += 1
    return {'rows': rows, 'malformed': malformed}


def transitions(receipts):
    """One row per receipt. Settled+observed rows carry the before/after
    compact snapshots and the reward hooks; everything else stays explicit
    about what is missing instead of inheriting a success label."""
    rows = []
    for receipt in receipts:
        before, after = receipt.get('before'), receipt.get('after')
        observed = isinstance(after, dict) and after.get('ok') is True
        row = {'actionId': receipt.get('actionId'), 'turnId': receipt.get('turnId'),
               'tool': receipt.get('tool'), 'args': receipt.get('args'),
               'status': receipt.get('status'),
               'settled': receipt.get('status') in SETTLED_STATUSES,
               'observationAvailable': observed,
               'completionConfirmed': receipt.get('completionConfirmed') is True,
               'navigationSuccess': _navigation_success(receipt),
               'acceptedAt': receipt.get('acceptedAt'), 'observedAt': receipt.get('observedAt')}
        if observed:
            before_vitals = before if isinstance(before, dict) else {}
            row['before'] = _compact_snapshot(before)
            row['after'] = _compact_snapshot(after)
            row['inventoryDelta'] = inventory_delta(before, after)
            row['displacement'] = displacement(before, after)
            for vital in ('hp', 'hunger'):
                change = None
                if _number(before_vitals.get(vital)) and _number(after.get(vital)):
                    change = after[vital] - before_vitals[vital]
                row[vital + 'Delta'] = change
        rows.append(row)
    return rows


def turn_rows(transition_rows, episodes):
    """Group transitions by turn and attach the decision outcome label that
    episodes.jsonl already records; skill events join only when they carry
    the same turnId. Legacy episode rows without a turn stay in the timeline
    counts only."""
    grouped = {}
    for row in transition_rows:
        if isinstance(row.get('turnId'), str):
            grouped.setdefault(row['turnId'], []).append(row)
    decisions, skills = {}, {}
    for row in episodes:
        kind = row.get('kind')
        if kind == 'decision_finished' and isinstance(row.get('turnId'), str):
            decisions[row['turnId']] = {'at': row.get('at'), 'taskId': row.get('taskId'),
                                        'resultStatus': row.get('resultStatus'),
                                        'completed': row.get('completed') is True,
                                        'nativeTaskCompleted': row.get('nativeTaskCompleted') is True}
        elif kind in SKILL_KINDS and isinstance(row.get('turnId'), str):
            skills.setdefault(row['turnId'], []).append(
                {key: row.get(key) for key in ('at', 'kind', 'name', 'status', 'reason') if key in row})
    turns = []
    for turn_id, rows in grouped.items():
        stamps = [_stamp(row.get('acceptedAt')) for row in rows]
        turns.append({'turnId': turn_id,
                      'firstAcceptedAt': min(stamps) if stamps else None,
                      'toolSequence': [row.get('tool') for row in rows],
                      'transitionCount': len(rows),
                      'decision': decisions.get(turn_id),
                      'skillEvents': skills.get(turn_id, []),
                      'transitions': rows})
    turns.sort(key=lambda turn: (turn['firstAcceptedAt'] or 0, turn['turnId']))
    return turns


def summarize(state_dir):
    """Data-card skeleton (gate G2): counts and ranges read straight from the
    files. No gameplay success is inferred here."""
    state_dir = Path(state_dir)
    receipts = load_receipts(state_dir)
    actions = load_jsonl(state_dir / 'actions.jsonl')
    episodes = load_jsonl(state_dir / 'episodes.jsonl')
    rows = transitions(receipts['receipts'])
    turns = turn_rows(rows, episodes['rows'])
    by_status = {}
    for receipt in receipts['receipts']:
        status = receipt.get('status')
        key = status if isinstance(status, str) else 'invalid_status'
        by_status[key] = by_status.get(key, 0) + 1
    by_kind = {}
    for row in episodes['rows']:
        kind = row.get('kind')
        key = kind if isinstance(kind, str) else 'unknown_kind'
        by_kind[key] = by_kind.get(key, 0) + 1
    by_phase = {}
    for row in actions['rows']:
        phase = row.get('phase')
        key = phase if isinstance(phase, str) else 'unknown_phase'
        by_phase[key] = by_phase.get(key, 0) + 1
    stamps = [receipt.get('acceptedAt') for receipt in receipts['receipts']
              if _number(receipt.get('acceptedAt'))]
    episode_times = []
    for row in episodes['rows']:
        try:
            episode_times.append(datetime.fromisoformat(row['at']))
        except (KeyError, TypeError, ValueError):
            continue
    return {
        'schema': 1, 'stateDir': str(state_dir),
        'receipts': {'total': len(receipts['receipts']), 'invalid': len(receipts['invalid']),
                     'invalidFiles': [row['file'] for row in receipts['invalid']],
                     'ignoredFiles': receipts['ignoredFiles'],
                     'byStatus': dict(sorted(by_status.items()))},
        'transitions': {'total': len(rows),
                        'observed': sum(1 for row in rows if row['observationAvailable']),
                        'settled': sum(1 for row in rows if row['settled'])},
        'episodes': {'rows': len(episodes['rows']), 'malformed': episodes['malformed'],
                     'byKind': dict(sorted(by_kind.items()))},
        'actionsLog': {'rows': len(actions['rows']), 'malformed': actions['malformed'],
                       'byPhase': dict(sorted(by_phase.items()))},
        'turns': {'total': len(turns),
                  'withDecision': sum(1 for turn in turns if turn['decision']),
                  'decisionCompleted': sum(1 for turn in turns
                                           if turn['decision'] and turn['decision']['completed'])},
        'timeRange': {'firstReceiptAcceptedAt': min(stamps) if stamps else None,
                      'lastReceiptAcceptedAt': max(stamps) if stamps else None,
                      'firstEpisodeAt': min(episode_times).isoformat() if episode_times else None,
                      'lastEpisodeAt': max(episode_times).isoformat() if episode_times else None},
        'rewardHooks': ('per transition: inventoryDelta/displacement/hpDelta/hungerDelta/'
                        'navigationSuccess; per turn: decision.completed; memory.goalState '
                        'and skill_* join later at training time'),
        'datasetNote': ('Action side only; (prompt, completion) originals stay in QwenPaw '
                        '(Step1b export channel).')}


def dataset(state_dir):
    """Convenience bundle: summary plus the normalized rows it was built from."""
    state_dir = Path(state_dir)
    receipts = load_receipts(state_dir)
    episodes = load_jsonl(state_dir / 'episodes.jsonl')
    rows = transitions(receipts['receipts'])
    return {'summary': summarize(state_dir), 'transitions': rows,
            'turns': turn_rows(rows, episodes['rows']),
            'invalidReceipts': receipts['invalid']}
