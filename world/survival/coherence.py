"""动作连贯性指标（生存侧自己算，写到共享位置给元层看板读）。

为什么要有它：只数"活着/产出/工单"看不出**动作是否连贯** —— 一个 agent 可以活着、
还在写知识，同时整天在 goto|goto|goto 里打转、动作被拒、目标原地不动。
2026-09-19 造物主点出这一点时，世界里的证据其实已经摊在那儿了：
environmentSignals 里一条 no_output（24 个动作、19587 秒、工具 goto/eat/game_cast）。

这个模块只读本进程已有的账本；指标用于诊断，不起模型、不发动作。
"""
import json
import time
from datetime import datetime, timezone
from pathlib import Path

from execution_evidence import load_receipts, repeats, summarize

STATE = Path('/state/survival')
SHARED = Path('/public') / 'survival-metrics.json'
ACTION_WINDOW = 400
PATTERN_WINDOW = 300
MIN_REPEATS = 3


def _tail_jsonl(path, limit):
    rows = []
    try:
        with path.open('rb') as stream:
            stream.seek(0, 2)
            size = stream.tell()
            stream.seek(max(0, size - 1_500_000))
            for line in stream.read().decode('utf-8', 'replace').splitlines()[-limit:]:
                line = line.strip()
                if line:
                    try:
                        rows.append(json.loads(line))
                    except ValueError:
                        continue
    except OSError:
        return []
    return rows


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
    episodes = _tail_jsonl(STATE / 'episodes.jsonl', PATTERN_WINDOW)
    records, errors = load_receipts(STATE / 'action-receipts', ACTION_WINDOW)
    actions = [record['receipt'] for record in records]
    repetition = _repeat_share(actions) if not errors else {
        'window': len(actions), 'share': None, 'inRepeats': None,
        'longestIdenticalRun': None, 'reason': 'incomplete_receipt_sequence'}
    stalled = {}
    try:
        stalled = json.loads((STATE / 'stagnation-state.json').read_text(encoding='utf-8')).get('tracked') or {}
    except (OSError, ValueError):
        pass
    now = time.time()
    oldest = None
    stamps = [value.get('at') for value in stalled.values() if isinstance(value, dict)
              and isinstance(value.get('at'), (int, float))]
    if stamps:
        oldest = max(0, round((now - min(stamps)) / 60))
    signals = controller.get('environmentSignals') or []
    return {
        'schema': 2, 'at': now, 'generatedBy': 'world/survival/coherence.py',
        'evidence': {'source': 'action-receipts', 'errors': errors,
                     'window': 'latest retained files; not all historical actions'},
        'closedLoop': _closed_loop(actions),
        'repeats': repetition,
        'decisionGaps': _decision_gaps(episodes),
        'stalledGoals': {'count': len(stalled), 'oldestMinutes': oldest,
                         'examples': [key[:40] for key in list(stalled)[:3]]},
        'noOutputSignals': [{'kind': s.get('kind'), 'actions': s.get('actions'),
                             'spanSeconds': s.get('span'), 'tools': (s.get('tools') or [])[:4]}
                            for s in signals[:3]],
        'noActionReviews': controller.get('noActionReviews'),
        'note': '确认成功率仅统计留存动作回执，不证明目标完成；重复要求同身体、维度、工具及参数，'
                '重复本身不证明停滞。决策间隔不等于当前卡住时长。schema 1 与 2 不可直接比较。',
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
