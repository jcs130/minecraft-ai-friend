"""动作连贯性指标（生存侧自己算，写到共享位置给元层看板读）。

为什么要有它：只数"活着/产出/工单"看不出**动作是否连贯** —— 一个 agent 可以活着、
还在写知识，同时整天在 goto|goto|goto 里打转、动作被拒、目标原地不动。
2026-09-19 造物主点出这一点时，世界里的证据其实已经摊在那儿了：
environmentSignals 里一条 no_output（24 个动作、19587 秒、工具 goto/eat/game_cast）。

这个模块只读本进程已有的账本；指标用于诊断，不起模型、不发动作。
"""
import json
import hashlib
import math
import time
from datetime import datetime, timezone
from pathlib import Path

from execution_evidence import (behavior_summary, load_receipts, repeats,
                                sampled_summary, summarize, time_buckets)

STATE = Path('/state/survival')
SHARED = Path('/public') / 'survival-metrics.json'
ACTION_WINDOW = 400
PATTERN_WINDOW = 300
MIN_REPEATS = 3


def _tail_jsonl(path, limit, *, with_coverage=False):
    rows = []
    coverage = {'selectedLines': 0, 'readFailures': 0, 'sampleTruncated': False}
    try:
        with path.open('rb') as stream:
            stream.seek(0, 2)
            size = stream.tell()
            stream.seek(max(0, size - 1_500_000))
            lines = stream.read().decode('utf-8', 'replace').splitlines()
            if size > 1_500_000:
                # The first line can start mid-record; it is not corrupt evidence.
                lines = lines[1:]
            coverage['sampleTruncated'] = size > 1_500_000 or len(lines) > limit
            lines = lines[-limit:]
            coverage['selectedLines'] = len(lines)
            for line in lines:
                line = line.strip()
                if line:
                    try:
                        row = json.loads(line)
                        if not isinstance(row, dict):
                            raise ValueError('invalid_episode')
                        rows.append(row)
                    except ValueError:
                        coverage['readFailures'] += 1
    except OSError:
        coverage['readFailures'] += 1
    return (rows, coverage) if with_coverage else rows


def _generation(controller, now):
    """Use the cutover timestamp persisted by archive_survivor_memory, not mtimes."""
    value = {'status': 'unavailable', 'memoryEpoch': None, 'startedAt': None,
             'source': 'settings.json:memoryStartedAt'}
    try:
        raw = (STATE / 'settings.json').read_bytes()
        settings = json.loads(raw)
        epoch, start = settings.get('memoryEpoch'), settings.get('memoryStartedAt')
        if (settings.get('brainProtocol') != 1 or not isinstance(epoch, str) or not epoch.strip()
                or type(start) not in (int, float) or not math.isfinite(start) or not 0 < start <= now * 1000):
            raise ValueError('generation_boundary_unavailable')
        if controller.get('memoryEpoch') not in (None, epoch):
            raise ValueError('generation_boundary_mismatch')
        value.update(status='current', memoryEpoch=epoch, startedAt=start,
                     markerSha256=hashlib.sha256(raw).hexdigest())
    except (OSError, ValueError, TypeError, AttributeError):
        value['reason'] = 'generation_boundary_unavailable_or_mismatched'
    return value


def _episode_timestamp(row):
    try:
        stamp = datetime.fromisoformat(row.get('at').replace('Z', '+00:00'))
        return stamp.timestamp() * 1000 if stamp.tzinfo is not None else None
    except (AttributeError, TypeError, ValueError, OverflowError):
        return None


def _runtime(controller):
    """Project control facts only; refreshing metrics never implies a running brain."""
    files, errors = {}, []
    for name in ('control', 'controller'):
        try:
            value = json.loads((STATE / (name + '.json')).read_bytes())
            if not isinstance(value, dict):
                raise ValueError('invalid_runtime_snapshot')
            files[name] = value
        except (OSError, ValueError, TypeError):
            files[name] = {}
            errors.append(name + '_unavailable')
    current = controller if 'status' in controller else files['controller']
    control = files['control']
    active = current.get('active') if isinstance(current.get('active'), dict) else {}
    def text(value):
        return value[:160] if isinstance(value, str) else None
    return {'status': text(current.get('status')),
            'enabled': control.get('enabled') if type(control.get('enabled')) is bool else None,
            'pauseReason': text(current.get('pauseReason') or control.get('pauseReason')),
            'activeTurnId': text(active.get('turnId')), 'readErrors': errors,
            'source': 'controller_snapshot/control.json' if current is controller else 'controller.json/control.json'}


def _current_generation(rows, generation, now, *, episodes=False):
    selected, seen = [], set()
    counts = {'currentGeneration': 0, 'priorGeneration': 0, 'unassigned': 0, 'duplicateIds': 0}
    for row in rows:
        identity = ((row.get('taskId') or row.get('turnId')) if episodes and row.get('kind') == 'decision_finished'
                    else row.get('actionId') if not episodes else None)
        if isinstance(identity, str) and identity:
            if identity in seen:
                counts['duplicateIds'] += 1
                continue
            seen.add(identity)
        stamp = _episode_timestamp(row) if episodes else row.get('acceptedAt')
        if (generation['status'] != 'current' or type(stamp) not in (int, float)
                or not math.isfinite(stamp) or not 0 < stamp <= now * 1000):
            counts['unassigned'] += 1
        elif stamp < generation['startedAt'] and row.get('memoryEpoch') == generation['memoryEpoch']:
            counts['unassigned'] += 1
        elif stamp < generation['startedAt']:
            counts['priorGeneration'] += 1
        elif row.get('memoryEpoch') not in (None, generation['memoryEpoch']):
            counts['unassigned'] += 1
        else:
            counts['currentGeneration'] += 1
            selected.append(row)
    return selected, counts


def _closed_loop(rows):
    """已确认动作成功率；不是任务完成率。只消费最终回执。"""
    return summarize(rows)


def _repeat_share(receipts):
    return repeats(receipts, MIN_REPEATS)


def _decision_gaps(episodes):
    """已完成决策的间隔；不能据此认定当前卡住时长。"""
    stamps = [row.get('at') for row in episodes if row.get('kind') == 'decision_finished']
    parsed = []
    for value in stamps:
        try:
            stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if stamp.tzinfo is not None:
                parsed.append(stamp.astimezone(timezone.utc).timestamp())
        except (AttributeError, TypeError, ValueError):
            continue
    parsed = sorted(set(parsed))
    gaps = [round(b - a) for a, b in zip(parsed, parsed[1:])]
    if not gaps:
        return {'samples': 0, 'medianSeconds': None, 'maxSeconds': None}
    gaps.sort()
    return {'samples': len(gaps), 'medianSeconds': gaps[len(gaps) // 2], 'maxSeconds': gaps[-1]}


def collect(controller=None):
    controller = controller or {}
    now = time.time()
    generation = _generation(controller, now)
    episodes, episode_coverage = _tail_jsonl(STATE / 'episodes.jsonl', PATTERN_WINDOW, with_coverage=True)
    episodes, episode_counts = _current_generation(episodes, generation, now, episodes=True)
    episode_coverage.update(episode_counts)
    records, errors, coverage = load_receipts(STATE / 'action-receipts', ACTION_WINDOW, with_coverage=True)
    actions, counts = _current_generation([record['receipt'] for record in records], generation, now)
    coverage.update(counts)
    incomplete = bool(errors or counts['unassigned'] or generation['status'] != 'current')
    repetition = _repeat_share(actions) if not incomplete else {
        'window': len(actions), 'share': None, 'inRepeats': None,
        'longestIdenticalRun': None, 'reason': 'incomplete_receipt_sequence'}
    stalled = {}
    try:
        stalled = json.loads((STATE / 'stagnation-state.json').read_text(encoding='utf-8')).get('tracked') or {}
    except (OSError, ValueError):
        pass
    oldest = None
    stamps = [value.get('at') for value in stalled.values() if isinstance(value, dict)
              and isinstance(value.get('at'), (int, float))]
    if stamps:
        oldest = max(0, round((now - min(stamps)) / 60))
    signals = controller.get('environmentSignals') or []
    return {
        'schema': 2, 'at': now, 'generatedBy': 'world/survival/coherence.py',
        'generation': generation,
        'runtime': _runtime(controller),
        'evidence': {'source': 'action-receipts', 'errors': errors,
                     'coverage': coverage, 'episodes': episode_coverage,
                     'window': 'latest retained files; not all historical actions'},
        'closedLoop': sampled_summary(actions, incomplete=incomplete),
        'behaviors': behavior_summary(actions, incomplete=incomplete),
        'trends': time_buckets(actions, started_at=generation['startedAt'] / 1000
                              if generation['startedAt'] is not None else None,
                              now=now, incomplete=incomplete),
        'repeats': repetition,
        'decisionGaps': dict(_decision_gaps(episodes),
                             definition='completed_model_turn_intervals_not_game_success_or_current_stall'),
        'stalledGoals': {'count': len(stalled), 'oldestMinutes': oldest,
                         'examples': [key[:40] for key in list(stalled)[:3]]},
        'noOutputSignals': [{'kind': s.get('kind'), 'actions': s.get('actions'),
                             'spanSeconds': s.get('span'), 'tools': (s.get('tools') or [])[:4]}
                            for s in signals[:3]],
        'noActionReviews': controller.get('noActionReviews'),
        'note': '确认成功率仅统计留存动作回执，不证明目标完成；重复要求同身体、维度、工具及参数，'
                '重复本身不证明停滞。决策间隔不等于当前卡住时长。schema 1 与 2 不可直接比较；'
                '不同记忆代、留存窗口和分桶样本不可据此声称能力提升，未建立因果对照。',
    }


def write(controller=None):
    value = collect(controller)
    try:
        SHARED.parent.mkdir(parents=True, exist_ok=True)
        SHARED.write_text(json.dumps(value, ensure_ascii=False, indent=1), encoding='utf-8')
        value['wrote'] = str(SHARED)
    except OSError as error:
        value['writeFailed'] = type(error).__name__
    try:
        (STATE / 'coherence-metrics.json').write_text(
            json.dumps(value, ensure_ascii=False, indent=1), encoding='utf-8')
    except OSError:
        pass
    return value


if __name__ == '__main__':
    print(json.dumps(write(), ensure_ascii=False))
