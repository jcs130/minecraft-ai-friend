"""Read-only evidence for diagnostics, never an action/retry or promotion policy.

Uses the gateway's persisted terminal receipts, not its append-only dispatch log.
Action completion and world deltas are deliberately separate from goal success.
"""
import hashlib
import json
import math
from collections import Counter
from pathlib import Path


def _object(value):
    return value if isinstance(value, dict) else {}


def _number(value):
    return type(value) in (int, float) and math.isfinite(value)


def signature(receipt):
    """Exact tool/arguments in one body and dimension; missing context is unknown."""
    before = _object(receipt.get('before'))
    if not (before.get('ok') is True and isinstance(before.get('bodyUuid'), str)
            and before.get('bodyUuid') and isinstance(before.get('dimension'), str)
            and before.get('dimension') and isinstance(receipt.get('tool'), str)
            and receipt.get('tool') and isinstance(receipt.get('args'), dict)):
        return None
    try:
        return json.dumps([before['bodyUuid'], before['dimension'], receipt['tool'], receipt['args']],
                          sort_keys=True, separators=(',', ':'), allow_nan=False)
    except (ValueError, TypeError):
        return None


def classify(receipt):
    """Conservative diagnostic label. This does not authorize gameplay or certify a skill."""
    if not isinstance(receipt, dict) or not receipt.get('actionId'):
        return 'unknown'
    result = _object(receipt.get('result'))
    native = _object(result.get('result'))
    status = receipt.get('status')
    if status in ('unknown', 'observed_ended') or result.get('code') == 'outcome_unknown':
        return 'unknown'
    if status == 'rejected' and result.get('ok') is False and native.get('success') is False:
        return 'rejected'
    if status in ('in_flight', 'accepted', 'pending'):
        return 'pending'
    if receipt.get('completionConfirmed') is not True:
        return 'unknown'
    navigation = _object(receipt.get('navigationOutcome'))
    food = _object(receipt.get('nativeFoodOutcome'))
    if receipt.get('nativeTaskId') and receipt.get('tool') == 'goto':
        if navigation.get('task_id') != receipt['nativeTaskId'] or type(navigation.get('success')) is not bool:
            return 'unknown'
        before, after = _object(receipt.get('before')), _object(receipt.get('after'))
        if navigation.get('navigation_mode') == 'observed_from_body':
            if not (before.get('ok') is True and after.get('ok') is True
                    and before.get('bodyUuid') and before.get('dimension')
                    and all(before.get(k) == after.get(k) for k in ('bodyUuid', 'dimension'))):
                return 'unknown'
        elif not (before.get('navigationEpoch')
                  and navigation.get('navigation_epoch') == before['navigationEpoch']):
            return 'unknown'
        if status == 'failed' and navigation['success'] is False:
            return 'failed'
        if navigation['success'] is not True:
            return 'unknown'
    if receipt.get('nativeTaskId') and receipt.get('tool') == 'eat':
        expected = _object(native.get('nativeFoodReceipt'))
        before = _object(receipt.get('before'))
        fields = ('epoch', 'actorUuid', 'requestId', 'tool', 'args', 'nativeTaskId')
        if not (food.get('epoch') and food.get('status') == 'terminal'
                and food.get('nativeTaskId') == receipt['nativeTaskId']
                and before.get('bodyUuid') and food.get('actorUuid') == before['bodyUuid']
                and food.get('requestId') == receipt['actionId']
                and food.get('tool') == receipt['tool'] and food.get('args') == receipt.get('args')
                and all(food.get(k) == expected.get(k) for k in fields)):
            return 'unknown'
        success = _object(food.get('result')).get('success')
        if status == 'failed' and success is False and food.get('nativeState') in ('FAILED', 'TIMEOUT', 'CANCELLED'):
            return 'failed'
        if not (success is True and food.get('nativeState') == 'SUCCESS'):
            return 'unknown'
    if status == 'completed' and result.get('ok') is True and native.get('success') is True:
        return 'succeeded'
    if status == 'failed' and result.get('ok') is False and native.get('success') is False:
        return 'failed'
    return 'unknown'


def observed_delta(receipt):
    before, after = _object(receipt.get('before')), _object(receipt.get('after'))
    if not (before.get('ok') is True and after.get('ok') is True and before.get('bodyUuid')
            and before.get('dimension')
            and all(before.get(k) == after.get(k) for k in ('bodyUuid', 'dimension'))):
        return None
    out = {}
    if isinstance(before.get('counts'), dict) and isinstance(after.get('counts'), dict):
        left, right = before['counts'], after['counts']
        out['inventory'] = {item: right.get(item, 0) - left.get(item, 0)
                            for item in sorted(left.keys() | right.keys())
                            if _number(left.get(item, 0)) and _number(right.get(item, 0))
                            and right.get(item, 0) != left.get(item, 0)}
    for field in ('hp', 'hunger'):
        if _number(before.get(field)) and _number(after.get(field)):
            out[field] = after[field] - before[field]
    a, b = _object(before.get('position')), _object(after.get('position'))
    if all(_number(p.get(k)) for p in (a, b) for k in ('x', 'y', 'z')):
        out['distance'] = round(math.dist([a[k] for k in ('x', 'y', 'z')],
                                        [b[k] for k in ('x', 'y', 'z')]), 3)
    return out


def load_receipts(directory, limit=400):
    """Bounded latest-file sample; return exact byte hashes and all read failures."""
    if type(limit) is not int or not 1 <= limit <= 10000:
        raise ValueError('receipt_limit_out_of_range')
    root = Path(directory)
    errors, files, records = [], [], []
    if not root.is_dir():
        return [], ['receipt_directory_unavailable']
    for path in root.glob('*.json'):
        try:
            files.append((path.stat().st_mtime_ns, path))
        except OSError:
            errors.append(path.name + ':stat_unavailable')
    for _, path in sorted(files)[-limit:]:
        try:
            raw = path.read_bytes()
            row = json.loads(raw)
            if not isinstance(row, dict) or row.get('actionId') != path.stem:
                raise ValueError('receipt_identity_mismatch')
            # Check JSON can form a deterministic signature before consuming it.
            json.dumps(row, allow_nan=False)
            records.append({'receipt': row, 'source': path.name,
                            'sha256': hashlib.sha256(raw).hexdigest()})
        except (OSError, ValueError, TypeError) as error:
            errors.append(path.name + ':' + type(error).__name__)
    records.sort(key=lambda item: (item['receipt'].get('acceptedAt')
                                 if _number(item['receipt'].get('acceptedAt')) else -1,
                                 item['receipt']['actionId']))
    return records, errors


def repeats(receipts, minimum=3):
    """Union of consecutive exact 1/2/3-action repeats, not evidence of failure.

    Unknown identity breaks a run. Changing arguments or body does not match.
    Overlapping patterns contribute each action at most once.
    """
    keys = [signature(row) for row in receipts]
    covered, patterns = set(), []
    longest, run, previous = 0, 0, None
    for key in keys:
        run = run + 1 if key is not None and key == previous else int(key is not None)
        longest = max(longest, run)
        previous = key
    for size in (1, 2, 3):
        start = 0
        while start + size * minimum <= len(keys):
            gram = keys[start:start + size]
            count = 1
            if all(key is not None for key in gram):
                while keys[start + count * size:start + (count + 1) * size] == gram:
                    count += 1
            if count >= minimum:
                end = start + count * size
                covered.update(range(start, end))
                patterns.append({'start': start, 'end': end, 'count': count,
                                 'tools': [receipts[i]['tool'] for i in range(start, start + size)]})
                start = end
            else:
                start += 1
    top = sorted(patterns, key=lambda item: -(item['end'] - item['start']))[:3]
    return {'window': len(keys), 'identified': sum(k is not None for k in keys),
            'inRepeats': len(covered), 'share': round(len(covered) / len(keys), 3) if keys else None,
            'longestIdenticalRun': longest,
            'topRepeats': ['|'.join(item['tools']) + '×' + str(item['count']) for item in top],
            'patterns': top, 'definition': 'consecutive_exact_body_dimension_tool_arguments',
            'notice': 'Repetition alone is not stagnation; inspect world deltas and the goal.'}


def summarize(receipts):
    counts = Counter(classify(row) for row in receipts)
    total = len(receipts)
    return {'sampled': total, 'succeeded': counts['succeeded'],
            'rate': round(counts['succeeded'] / total, 3) if total else None,
            'outcomes': {k: counts[k] for k in ('succeeded', 'failed', 'rejected', 'pending', 'unknown')},
            'codes': dict(Counter(str(_object(row.get('result')).get('code') or 'unknown')
                                  for row in receipts).most_common(6)),
            'definition': 'confirmed_action_successes / sampled_persisted_receipts',
            'objectiveSuccessRate': None,
            'notice': 'Action completion is not proof of goal achievement or improvement.'}
