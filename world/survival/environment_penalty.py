"""Environment penalties as evolution triggers (真实反馈 → 进化诱因).

Sibling of :mod:`pattern_detector`, deliberately not a replacement.

That one *infers*: it watches for repeated action sequences and guesses whether
the repetition is worth crystallising, so it also fires on legitimate work — on
2026-09-17 it reported ``goto x6 repeats=3`` while the agent was simply walking
between farm plots. The detector was wrong, not the agent.

This one reads the environment's own verdict instead: a rejection the world
handed back, health the body actually lost, a target that never changed. The
world states those plainly, so they do not carry that class of false positive.

Pure observation, like its sibling: nothing is executed, no model is called,
no game state is touched. The agent decides what a signal means.
"""
import json
import re
import time
from pathlib import Path
from collections import Counter

WINDOW = 24                     # how many recent receipts to consider
REJECTION_REPEAT_THRESHOLD = 3  # same rejection this many times = a repeated obstacle
STUCK_REPEAT_THRESHOLD = 3      # same tool+target this many times with no output
DAMAGE_MIN_DROP = 4.0           # total health lost in the window worth reporting
DAMAGE_MIN_EVENTS = 2           # a single ordinary hit is not a pattern
NEAR_DEATH_HP = 6.0             # at or below this, report even if it was one hit
NO_OUTPUT_MIN_ACTIONS = 6       # busy this many times...
NO_OUTPUT_MIN_SPAN = 480        # ...across at least this many seconds...
COOLDOWN_SECONDS = 300
MAX_HINTS = 2

# Tools that change the world. Movement and housekeeping are not in here: the
# signal below exists precisely because an agent can be extremely busy moving
# while producing nothing at all, which is what 2026-09-17 looked like.
PRODUCTIVE_TOOLS = frozenset((
    'farm', 'mine', 'craft', 'place_block', 'collect_items', 'build', 'fish',
    'take_items', 'transfer_items', 'attack', 'use_block',
))

# Codes the gateway uses for work that was carried out or accepted. Anything
# else is the world refusing, which is the signal this module exists for.
SUCCESS_CODES = frozenset(('accepted', 'executed', 'completed', 'confirmed', 'ok', 'success'))
_COORDINATES = re.compile(r'-?\d+(?:\.\d+)?')
HINT_PATH_NAME = 'environment-penalty-hint.json'
COOLDOWN_PATH_NAME = 'environment-penalty-cooldown.json'


def _rejection_key(record):
    """Identity of a refusal: tool + code + message with numbers masked.

    Masking matters: ``aim -639,64,1054 is blocked`` and
    ``aim -638,64,1056 is blocked`` are the same obstacle at two cells, and the
    live world produced about 66 of exactly that in a day.
    """
    code = record.get('code')
    if not code or code in SUCCESS_CODES:
        return None
    message = _COORDINATES.sub('#', str(record.get('message') or ''))[:60].strip()
    return '%s|%s|%s' % (record.get('tool'), code, message)


def _target(args):
    if not isinstance(args, dict):
        return None
    if all(k in args for k in ('x', 'y', 'z')):
        return (args.get('x'), args.get('y'), args.get('z'))
    if all(k in args for k in ('x', 'z')):
        return (args.get('x'), None, args.get('z'))
    return None


def _work_key(record):
    """What the action was aimed at doing, not merely which cell it touched.

    The operation is part of the identity: harvesting, tilling and planting the
    same cell is a normal farming round, not a repetition.
    """
    target = record.get('target')
    if not target:
        return None
    operation = (record.get('args') or {}).get('operation')
    return (record.get('tool'), str(operation) if operation else None, target)


def _longest_run(records, key):
    """Longest stretch of consecutive records sharing one identity."""
    best = current = 0
    last = object()
    for record in records:
        k = key(record)
        if k is not None and k == last:
            current += 1
        else:
            current = 1 if k is not None else 0
        best = max(best, current)
        last = k if k is not None else object()
    return best


def _counts(side):
    value = side.get('counts') if isinstance(side, dict) else None
    return value if isinstance(value, dict) else {}


def _hp(side):
    value = side.get('hp') if isinstance(side, dict) else None
    return value if isinstance(value, (int, float)) else None


def normalize(raw):
    """One receipt (or the shape a caller has in hand) -> a flat record.

    Every field is optional; a partial record simply contributes fewer signals.
    """
    if not isinstance(raw, dict):
        return None
    result = raw.get('result') if isinstance(raw.get('result'), dict) else {}
    inner = result.get('result') if isinstance(result.get('result'), dict) else {}
    before, after = raw.get('before') or {}, raw.get('after') or {}
    args = raw.get('args') if isinstance(raw.get('args'), dict) else {}
    return {
        'tool': raw.get('tool'),
        'args': args,
        'code': result.get('code'),
        'message': inner.get('message') or '',
        'acceptedAt': raw.get('acceptedAt'),
        'hpBefore': _hp(before), 'hpAfter': _hp(after),
        'countsBefore': _counts(before), 'countsAfter': _counts(after),
        'target': _target(args),
    }


def parse(receipts_dir, limit=WINDOW):
    """Read the newest receipts, oldest first, into flat records.

    A malformed or partial receipt is skipped rather than allowed to raise,
    because this runs inside the agent's own loop.
    """
    records = []
    try:
        files = sorted(Path(receipts_dir).glob('*.json'), key=lambda p: p.stat().st_mtime)
    except OSError:
        return records
    for path in files[-limit:]:
        try:
            raw = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        record = normalize(raw)
        if record is not None:
            records.append(record)
    return records


def detect(records):
    """Environment verdicts in this window. Pure function; no I/O.

    Takes records as produced by :func:`normalize` / :func:`parse`.
    Returns a list of signal dicts, strongest first.
    """
    signals = []
    if not records:
        return signals

    # 1. The same refusal, over and over: the world is saying the same thing and
    #    the caller keeps re-sending. On 2026-09-17 this ran 15 times / 20 minutes.
    keys = Counter(k for k in (_rejection_key(r) for r in records) if k)
    for key, count in keys.most_common(2):
        if count >= REJECTION_REPEAT_THRESHOLD:
            tool, code, message = key.split('|', 2)
            signals.append({
                'kind': 'repeated_rejection', 'tool': tool, 'code': code,
                'repeats': count, 'observed': message,
            })

    # 2. Health actually lost. One ordinary hit is not a pattern; a near-death
    #    result is worth reporting on its own.
    drops = [(r, (r['hpBefore'] - r['hpAfter'])) for r in records
             if r['hpBefore'] is not None and r['hpAfter'] is not None
             and r['hpAfter'] < r['hpBefore']]
    total = sum(d for _, d in drops)
    lowest = min((r['hpAfter'] for r, _ in drops), default=None)
    if drops and (len(drops) >= DAMAGE_MIN_EVENTS or (lowest is not None and lowest <= NEAR_DEATH_HP)
                  or total >= DAMAGE_MIN_DROP * DAMAGE_MIN_EVENTS):
        signals.append({
            'kind': 'damage', 'events': len(drops), 'total': round(total, 1),
            'lowest': lowest, 'nearDeath': bool(lowest is not None and lowest <= NEAR_DEATH_HP),
            'tools': [r['tool'] for r, _ in drops][-4:],
        })

    # 3. Sent to the same place again and again while the pack never grew: the
    #    agent is moving, but the world is not changing. (Position alone would
    #    miss this - on 2026-09-17 it moved back and forth to one cell.)
    #    Only actions the world actually carried out count here: a refusal is
    #    already reported above, and "the world said no" and "the world said yes
    #    but nothing changed" are different findings.
    carried_out = [r for r in records if r['code'] in SUCCESS_CODES and r['target']]
    if carried_out and not _gained(carried_out):
        # A run, not a tally. Three returns to the farm plot spread across twenty
        # minutes with successful work in between is going home, not hammering a
        # cell - the real-data false positive that tightened this on 2026-09-17.
        run = _longest_run(carried_out, _work_key)
        if run >= STUCK_REPEAT_THRESHOLD:
            repeated = Counter(_work_key(r) for r in carried_out).most_common(1)[0][0]
            signals.append({
                'kind': 'stuck_no_progress', 'tool': repeated[0], 'target': list(repeated[2]),
                'repeats': run, 'inventoryGained': False,
            })

    # 4. Busy for a long stretch without producing anything. This is the signal
    #    2026-09-17 actually needed: the agent submitted actions for about a
    #    hundred minutes (13 gotos in one ten-minute bucket) while nothing was
    #    tilled, planted, mined or crafted, and the pack did not grow. Neither a
    #    refusal (there were almost none) nor a single repeated target (it moved
    #    all over the farm) describes that; "active, no output" does.
    output = [r for r in records
              if r['tool'] in PRODUCTIVE_TOOLS and r['code'] in SUCCESS_CODES]
    stamps = [r['acceptedAt'] for r in records if isinstance(r['acceptedAt'], (int, float))]
    span = (max(stamps) - min(stamps)) / 1000.0 if len(stamps) >= 2 else 0.0
    if (not output and len(records) >= NO_OUTPUT_MIN_ACTIONS and span >= NO_OUTPUT_MIN_SPAN):
        signals.append({
            'kind': 'no_output', 'actions': len(records), 'span': int(span),
            'tools': [t for t, _ in Counter(r['tool'] for r in records).most_common(3)],
            'inventoryGained': bool(_gained(records)),
        })
    return signals


def _gained(records):
    """Items the pack gained across the window, by id."""
    first = next((r['countsBefore'] for r in records if r['countsBefore']), {})
    last = next((r['countsAfter'] for r in reversed(records) if r['countsAfter']), {})
    gained = {}
    for item, count in (last or {}).items():
        delta = count - (first or {}).get(item, 0)
        if isinstance(delta, (int, float)) and delta > 0:
            gained[item] = delta
    return gained


def _message(signals):
    """Plain-language summary of what the environment just said."""
    parts = []
    for s in signals:
        if s['kind'] == 'repeated_rejection':
            parts.append(
                '你最近 %d 次调用 %s 都被同一个原因挡了：%s。'
                '这不是偶发，是同一个障碍在重复——先照这条消息说的原因改参数、改站位或换手段，'
                '不要把同样的请求再发一次。' % (s['repeats'], s['tool'], s['observed'] or s['code']))
        elif s['kind'] == 'damage':
            parts.append(
                '你这段时间实际掉了 %s 点血（%d 次受伤，最低 %s/20）。'
                '记下受伤时的位置和你正在做的事；同一个地方反复掉血就是危险区域，'
                '要么绕开，要么换做法，要么先把命保住。'
                % (s['total'], s['events'], s['lowest']))
        elif s['kind'] == 'stuck_no_progress':
            parts.append(
                '%s 在同一个目标 %s 上重复了 %d 次，而背包毫无增长。'
                '你在动，但世界没变——这说明当前手段达不到目的，'
                '换手段或换目标，别继续原地重复。'
                % (s['tool'], s['target'], s['repeats']))
        elif s['kind'] == 'no_output':
            parts.append(
                '%d 个动作、约 %d 分钟，没有任何生产性产出（没种成、没挖到、没合成），背包也没涨，'
                '主要在做 %s。如果你确实在赶路或观察，这没问题；'
                '如果你本意是完成某件事，那就是当前做法不奏效——换手段，别再把时间花在同一条路上。'
                % (s['actions'], s['span'] // 60, '、'.join(s['tools'])))
    return '【环境反馈】' + ' '.join(parts)


class EnvironmentPenaltyDetector:
    """Turns environment verdicts into hints for the review cycle."""

    def __init__(self, state_dir, clock=time.time):
        self.state_dir = Path(state_dir)
        self.clock = clock
        self.hint_path = self.state_dir / HINT_PATH_NAME
        self.cooldown_path = self.state_dir / COOLDOWN_PATH_NAME
        self._last = self._load_cooldown()

    def _load_cooldown(self):
        try:
            data = json.loads(self.cooldown_path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return {}
        if not isinstance(data, dict):
            return {}
        return {k: v for k, v in data.items() if isinstance(v, (int, float))}

    def _save_cooldown(self):
        now = self.clock()
        live = {k: v for k, v in self._last.items() if now - v < COOLDOWN_SECONDS}
        self._last = live
        try:
            self.cooldown_path.write_text(json.dumps(live, ensure_ascii=False) + '\n', encoding='utf-8')
        except OSError:
            pass  # Best-effort, like the sibling detector: never block detection.

    def check(self, receipts_dir):
        """Return new hints, honouring the per-signal cooldown."""
        signals = detect(parse(receipts_dir))
        now = self.clock()
        fresh = []
        for s in signals:
            key = '%s|%s' % (s['kind'], s.get('tool') or '')
            if now - self._last.get(key, 0) < COOLDOWN_SECONDS:
                continue
            self._last[key] = now
            fresh.append(s)
        if not fresh:
            if self.hint_path.exists():
                # A cleared signal must not keep accelerating reviews.
                try:
                    self.hint_path.unlink()
                except OSError:
                    pass
            return []
        hints = [{
            'type': 'environment_penalty_hint',
            'signals': fresh,
            'message': _message(fresh),
            'detectedAt': now,
        }]
        self._save_cooldown()
        try:
            self.hint_path.write_text(
                json.dumps(hints[:MAX_HINTS], ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        except OSError:
            pass
        return hints[:MAX_HINTS]

    def get_pending_hint(self):
        if not self.hint_path.exists():
            return None
        try:
            hints = json.loads(self.hint_path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return None
        if isinstance(hints, list) and hints:
            return hints[0]
        return None

    def clear_hint(self):
        if self.hint_path.exists():
            try:
                self.hint_path.unlink()
            except OSError:
                pass
