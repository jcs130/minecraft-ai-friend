"""动作连贯性指标（生存侧自己算，写到共享位置给元层看板读）。

为什么要有它：只数"活着/产出/工单"看不出**动作是否连贯** —— 一个 agent 可以活着、
还在写知识，同时整天在 goto|goto|goto 里打转、动作被拒、目标原地不动。
2026-09-19 造物主点出这一点时，世界里的证据其实已经摊在那儿了：
environmentSignals 里一条 no_output（24 个动作、19587 秒、工具 goto/eat/game_cast）。

这个模块只读本进程已有的账本，不算新指标、不起模型、不发动作。
"""
import json
import time
from collections import Counter
from pathlib import Path

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
    """动作闭环率：手伸出去，事情做成了没有。"""
    codes = Counter()
    for row in rows:
        result = row.get('result') if isinstance(row.get('result'), dict) else {}
        codes[str(result.get('code') or result.get('status') or 'unknown')] += 1
    total = sum(codes.values()) or 1
    good = sum(count for code, count in codes.items() if code in ('accepted', 'ok', 'completed'))
    return {'sampled': sum(codes.values()), 'succeeded': good,
            'rate': round(good / total, 3), 'codes': dict(codes.most_common(6))}


def _repeat_share(episodes):
    """重复占比：这段动作里有多少个，落在"重复≥3 次"的短序列里。"""
    actions = [row.get('action') for row in episodes
               if row.get('kind') == 'action_observed' and isinstance(row.get('action'), str)]
    if len(actions) < 6:
        return {'window': len(actions), 'inRepeats': 0, 'share': None}
    found = {}
    for size in (2, 3):
        index = 0
        while index <= len(actions) - size:
            gram = tuple(actions[index:index + size])
            found[gram] = found.get(gram, 0) + 1
            index += 1
    repeated = {gram for gram, count in found.items() if count >= MIN_REPEATS}
    inside = 0
    for size in (3, 2):
        index = 0
        while index <= len(actions) - size:
            gram = tuple(actions[index:index + size])
            if gram in repeated:
                inside += size
                index += size
            else:
                index += 1
    inside = min(inside, len(actions))
    return {'window': len(actions), 'inRepeats': inside,
            'share': round(inside / len(actions), 3),
            'topRepeats': ['|'.join(gram) + '×%d' % count
                           for gram, count in sorted(found.items(), key=lambda kv: -kv[1])[:3]
                           if count >= MIN_REPEATS]}


def _decision_gaps(episodes):
    """决策间隔：中位与最长 —— 最长那个就是"卡住了多久"。"""
    stamps = [row.get('at') for row in episodes if row.get('kind') == 'decision_finished']
    parsed = []
    for value in stamps:
        try:
            parsed.append(time.mktime(time.strptime(value[:19], '%Y-%m-%dT%H:%M:%S')))
        except (TypeError, ValueError):
            continue
    parsed.sort()
    gaps = [round(b - a) for a, b in zip(parsed, parsed[1:])]
    if not gaps:
        return {'samples': 0, 'medianSeconds': None, 'maxSeconds': None}
    gaps.sort()
    return {'samples': len(gaps), 'medianSeconds': gaps[len(gaps) // 2], 'maxSeconds': gaps[-1]}


def collect(controller=None):
    controller = controller or {}
    episodes = _tail_jsonl(STATE / 'episodes.jsonl', PATTERN_WINDOW)
    actions = _tail_jsonl(STATE / 'actions.jsonl', ACTION_WINDOW)
    stalled = {}
    try:
        stalled = json.loads((STATE / 'stagnation-state.json').read_text(encoding='utf-8')).get('tracked') or {}
    except (OSError, ValueError):
        pass
    now = time.time()
    oldest = None
    if stalled:
        oldest_stamp = min((value.get('at') or now) for value in stalled.values() if isinstance(value, dict))
        oldest = round((now - oldest_stamp) / 60)
    signals = controller.get('environmentSignals') or []
    return {
        'schema': 1, 'at': now, 'generatedBy': 'world/survival/coherence.py',
        'closedLoop': _closed_loop(actions),
        'repeats': _repeat_share(episodes),
        'decisionGaps': _decision_gaps(episodes),
        'stalledGoals': {'count': len(stalled), 'oldestMinutes': oldest,
                         'examples': [key[:40] for key in list(stalled)[:3]]},
        'noOutputSignals': [{'kind': s.get('kind'), 'actions': s.get('actions'),
                             'spanSeconds': s.get('span'), 'tools': (s.get('tools') or [])[:4]}
                            for s in signals[:3]],
        'noActionReviews': controller.get('noActionReviews'),
        'note': '动作连贯性：闭环率=手伸出去事做成了没有；重复占比=有多少动作落在重复≥3 次的短序列里；'
                '决策间隔最长值=卡住多久；停滞目标=方向是否还在原地。',
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
