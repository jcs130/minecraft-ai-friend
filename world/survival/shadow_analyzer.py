"""Shadow paired analyzer: compare Jev's routine choices with what the slow brain actually did.

Method from SkillAudit (arXiv 2606.14239): paired trajectory auditing —
same context, compare with-skill (Jev candidate) vs without-skill (what
the planner actually did) outcomes. Ground-truth free: uses behavioral
divergence as the signal.

Reads /state/survival/routine-shadow.jsonl (read-only, agent cannot write
this file per the detector-immutability iron rule).
Outputs a diagnostic report: alignment gaps, confidence calibration,
and candidate edit suggestions.
"""
import json
import sys
from collections import Counter
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

LEDGER = Path('/state/survival/routine-shadow.jsonl')


def load():
    entries = []
    if not LEDGER.exists():
        return entries
    for line in LEDGER.read_text(encoding='utf-8').splitlines():
        try:
            entries.append(json.loads(line))
        except (json.JSONDecodeError, ValueError):
            continue
    return entries


def analyze(entries):
    if not entries:
        print('（台账为空）')
        return

    n = len(entries)
    choices = Counter(e.get('choice') for e in entries)
    codes = Counter(e.get('code') for e in entries)
    confidences = [e.get('confidence') for e in entries if isinstance(e.get('confidence'), (int, float))]

    # Alignment: how often does Jev pick a real action (not none)?
    action_picks = sum(1 for e in entries if e.get('choice') not in (None, 'none'))
    none_picks = choices.get('none', 0) + choices.get(None, 0)

    # Escalation rate: policy_escalated means Jev didn't feel confident enough
    escalated = codes.get('policy_escalated', 0)
    would_execute = sum(1 for e in entries
                        if isinstance(e.get('confidence'), (int, float)) and e['confidence'] >= 0.75)

    # Hunger context: when hungry, does Jev pick eat?
    hungry_entries = [e for e in entries if isinstance(e.get('hunger'), (int, float)) and e['hunger'] <= 13]
    hungry_eat = sum(1 for e in hungry_entries if 'eat' in str(e.get('choice', '')))

    # Position diversity: is the body moving or stuck?
    positions = set()
    for e in entries:
        pos = e.get('position')
        if isinstance(pos, dict):
            positions.add((round(pos.get('x', 0)), round(pos.get('z', 0))))

    # Latency stats
    latencies = [e.get('latencyMs') for e in entries if isinstance(e.get('latencyMs'), (int, float))]

    print(f'=== 影子配对分析（{n} 条）===')
    print(f'选择分布: {dict(choices)}')
    print(f'结果分布: {dict(codes)}')
    print(f'动作候选命中率: {action_picks}/{n} ({100*action_picks/n:.0f}%)')
    print(f'none/放弃率: {none_picks}/{n} ({100*none_picks/n:.0f}%)')
    print(f'升级率（置信<0.75）: {escalated}/{n} ({100*escalated/n:.0f}%)')
    print(f'假如有 routineLive: {would_execute}/{n} ({100*would_execute/n:.0f}%) 会直接执行')
    if confidences:
        avg_c = sum(confidences) / len(confidences)
        print(f'置信均值: {avg_c:.3f} · 范围 [{min(confidences):.2f}, {max(confidences):.2f}]')
    if hungry_entries:
        print(f'饥饿时选吃: {hungry_eat}/{len(hungry_entries)}')
    print(f'位置去重: {len(positions)} 个不同位置（{"在动" if len(positions) > 3 else "可能没动"}）')
    if latencies:
        avg_l = sum(latencies) / len(latencies)
        print(f'Jev 时延均值: {avg_l:.0f}ms · 最大 {max(latencies):.0f}ms')

    # Alignment gap detection: if Jev keeps picking goto_leg but confidence is low
    goto_low = [e for e in entries if e.get('choice') == 'goto_leg'
                and isinstance(e.get('confidence'), (int, float)) and e['confidence'] < 0.5]
    if goto_low:
        print(f'\n⚠ 对齐缺口: goto_leg 被选 {choices.get("goto_leg",0)} 次但低置信(<0.5)有 {len(goto_low)} 次')
        print('  → 候选编辑建议: goto_leg 的目标源从"锚点"换成"当前目标航点"')

    eat_low = [e for e in entries if 'eat' in str(e.get('choice', ''))
               and isinstance(e.get('confidence'), (int, float)) and e['confidence'] < 0.5]
    if eat_low:
        print(f'\n⚠ eat 候选低置信: {len(eat_low)} 次')

    if not would_execute and n > 20:
        print('\n⚠ 零条会直接执行——全部升级到慢脑。')
        print('  → 候选面太窄或问题措辞不佳。扩大日常行为候选或重写 question。')


if __name__ == '__main__':
    analyze(load())
