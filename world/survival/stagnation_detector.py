"""Stagnation redirect (P1): notice when the goal itself has stopped advancing.

The sibling of :mod:`environment_penalty`, and deliberately a different question.

That one reads the world: health lost, a refusal, no production. This one reads the
agent's own intent: the goal it wrote down has not changed, its state is still
in-progress or blocked, and the world has been saying for a while that nothing is
coming of it. Neither layer can see what the other sees - the world cannot tell that
the goal is stale, and the goal cannot tell that the body is being refused.

Following the design in docs/EVOLUTION-MECHANISM-PLAN.md: environment truth leads,
inference corroborates. A stale goal alone does not fire, because a long haul (walking
somewhere, waiting for a crop) is a legitimately unchanged goal. It fires when the
environment penalty layer also reports that the time is not being turned into anything:
no_output, or a repeated refusal. When it fires, the review cycle asks the agent to
take the four pivot steps rather than keep spending turns on the same approach.
"""
import json
import re
import time
from pathlib import Path

SCHEMA = 1
HINT_PATH_NAME = 'stagnation-hint.json'
STATE_PATH_NAME = 'stagnation-state.json'
# A goal that has not moved for this long, while the world reports no production, is
# stale rather than merely slow. Ten minutes is one review cadence: waiting two cycles
# before saying anything let a stall run for twenty minutes before anyone noticed
# (2026-09-18), and the review is where this hint lands anyway.
MIN_STAGNATION_SECONDS = 600
COOLDOWN_SECONDS = 900
MAX_HINT_BYTES = 8192
CORROBORATING = ('no_output', 'repeated_rejection')


def _fingerprint(goal):
    """Identity of an intent, stable against punctuation and whitespace."""
    if not isinstance(goal, str):
        return None
    normalised = re.sub(r'\s+', '', goal.strip())
    return normalised[:200] or None


PIVOT_STEPS = (
    '① 诚实诊断天花板：先看最近这一段真实轨迹，说清"我一直在做什么、世界给了我什么回音"；'
    '原地重复不等于努力，它是该换方向的信号。'
    '② 找一个最高 EV 的、还没试过的方向：区分"被证据否掉的"和"被我不愿意否掉的"——后者才是候选。'
    '③ 承诺，不许浅尝：新方向至少真的做三次再判生死，每次自己标 1/3、2/3、3/3。'
    '④ 把结论写进 lesson：哪条路被证明走不通、为什么，这样下一世不必重走。'
)


def detect(memory, penalties, first_seen, now):
    """Decide whether this goal has gone stale. Pure function of its inputs.

    ``penalties`` is the environment layer's output for the same window, so this
    reports only when the world agrees that nothing is being produced.
    """
    goal = _fingerprint(memory.get('goal')) if isinstance(memory, dict) else None
    if not goal:
        return None
    state = str((memory or {}).get('goalState') or '').strip().lower()
    if state not in ('ongoing', 'blocked', ''):
        return None
    since = first_seen.get('at')
    if not isinstance(since, (int, float)) or since <= 0:
        return None
    unchanged = now - since
    if unchanged < MIN_STAGNATION_SECONDS:
        return None
    kinds = {signal.get('kind') for signal in penalties or [] if isinstance(signal, dict)}
    corroboration = sorted(kinds & set(CORROBORATING))
    if not corroboration:
        # The world is being productive; a long haul is not stagnation.
        return None
    return {'goal': goal[:120], 'goalState': state or 'unknown', 'unchangedSeconds': int(unchanged),
            'corroboration': corroboration, 'instruction': PIVOT_STEPS}


class StagnationDetector:
    """Turns a stale goal into a pivot hint for the review cycle."""

    def __init__(self, state_dir, clock=time.time):
        self.state_dir = Path(state_dir)
        self.clock = clock
        self.hint_path = self.state_dir / HINT_PATH_NAME
        self.state_path = self.state_dir / STATE_PATH_NAME

    def _state(self):
        try:
            value = json.loads(self.state_path.read_text(encoding='utf-8'))
            if isinstance(value, dict) and value.get('schema') == SCHEMA:
                return value
        except (OSError, ValueError):
            pass
        return {'schema': SCHEMA, 'tracked': {}, 'lastHintAt': {}}

    def _save(self, state):
        state['schema'] = SCHEMA
        temporary = self.state_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temporary.replace(self.state_path)

    @staticmethod
    def _bounded(tracked):
        """Keep the ledger to the goals seen most recently: this runs every tick."""
        if len(tracked) <= 32:
            return tracked
        return dict(sorted(tracked.items(), key=lambda kv: kv[1].get('at', 0))[-32:])

    def check(self, memory, penalties):
        """Track the goal, and return a hint when it has gone stale."""
        now = self.clock()
        state = self._state()
        goal = _fingerprint(memory.get('goal')) if isinstance(memory, dict) else None
        tracked = state.get('tracked') or {}
        if not goal:
            self._save(state)
            return []
        if goal not in tracked:
            tracked[goal] = {'at': now}
            state['tracked'] = self._bounded(tracked)
            self._save(state)
            return []          # a goal we have just met is not stale by definition
        state['tracked'] = self._bounded(tracked)
        finding = detect(memory, penalties, tracked[goal], now)
        if finding is None:
            if self.hint_path.exists():
                try:
                    self.hint_path.unlink()
                except OSError:
                    pass
            self._save(state)
            return []
        last = (state.get('lastHintAt') or {}).get(goal, 0)
        if now - last < COOLDOWN_SECONDS:
            self._save(state)
            return []
        hint = {'type': 'stagnation_hint', 'detectedAt': now,
                'message': ('目标「%s」已经 %d 分钟没有推进（状态 %s），'
                            '而环境这段时间一直在说：%s。请按四步重定向，'
                            '不要再用同样的做法消耗回合。'
                            % (finding['goal'], finding['unchangedSeconds'] // 60,
                               finding['goalState'], '、'.join(finding['corroboration']))),
                'pivot': finding['instruction'], 'goal': finding['goal'],
                'unchangedSeconds': finding['unchangedSeconds'],
                'corroboration': finding['corroboration']}
        (state.setdefault('lastHintAt', {}))[goal] = now
        self._save(state)
        try:
            self.hint_path.write_text(json.dumps([hint], ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        except OSError:
            pass
        return [hint]

    def get_pending_hint(self):
        if not self.hint_path.exists() or self.hint_path.stat().st_size > MAX_HINT_BYTES:
            return None
        try:
            hints = json.loads(self.hint_path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return None
        return hints[0] if isinstance(hints, list) and hints else None

    def clear_hint(self):
        if self.hint_path.exists():
            try:
                self.hint_path.unlink()
            except OSError:
                pass
