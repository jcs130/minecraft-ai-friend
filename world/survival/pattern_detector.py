"""Automatic pattern detection and skill crystallization (熟能生巧).

Watches the stream of action receipts, detects repeated tool sequences,
and when a pattern repeats enough times, produces a crystallization hint
that the controller injects into the next LLM decision prompt — nudging
the agent to convert the repeating sequence into a programmed skill.

Pure observation: this module never executes actions or calls models.
It only detects patterns and produces hints. The agent (System 2) decides
whether to act on the hint.
"""
import json
import time
from pathlib import Path
from collections import Counter


# A pattern is interesting if: sequence length >= 2, repeated >= CRYSTALLIZE_THRESHOLD times
MIN_PATTERN_LEN = 2
CRYSTALLIZE_THRESHOLD = 3
COOLDOWN_SECONDS = 300  # don't re-hint about the same pattern within 5 minutes
MAX_RECENT = 30  # how many recent receipts to analyze
MAX_HINTS_PER_TICK = 1  # only inject one hint per decision cycle


class PatternDetector:
    """Detects repeating action sequences from the receipt stream."""

    def __init__(self, state_dir: Path, clock=time.time):
        self.state_dir = Path(state_dir)
        self.clock = clock
        self.hint_path = self.state_dir / 'crystallization-hint.json'
        self._last_hints = {}

    def _recent_tools(self, receipts_dir: Path) -> list:
        """Extract tool names from the most recent receipts, oldest first."""
        receipts = sorted(receipts_dir.glob('*.json'), key=lambda p: p.stat().st_mtime)
        recent = receipts[-MAX_RECENT:]
        tools = []
        for r in recent:
            try:
                d = json.loads(r.read_text(encoding='utf-8'))
                tools.append(d.get('tool', '?'))
            except (json.JSONDecodeError, OSError):
                continue
        return tools

    def detect_patterns(self, tools: list) -> list:
        """Find repeating contiguous subsequences in a tool list.

        Returns patterns sorted by (repeat_count * length) descending.
        Each pattern is {'sequence': [...], 'repeats': int, 'span': int}.
        """
        if len(tools) < MIN_PATTERN_LEN * CRYSTALLIZE_THRESHOLD:
            return []

        patterns = []
        n = len(tools)

        # Try all subsequence lengths from longest useful down to minimum
        for length in range(min(6, n // CRYSTALLIZE_THRESHOLD), MIN_PATTERN_LEN - 1, -1):
            # Slide a window of `length` across the sequence
            seen = {}
            for i in range(n - length + 1):
                seq = tuple(tools[i:i + length])
                if seq in seen:
                    seen[seq].append(i)
                else:
                    seen[seq] = [i]

            for seq, positions in seen.items():
                if len(positions) >= CRYSTALLIZE_THRESHOLD:
                    # Check positions are roughly contiguous (not spread across entire history)
                    span = positions[-1] - positions[0]
                    if span <= length * len(positions) + 2:  # Allow small gaps
                        patterns.append({
                            'sequence': list(seq),
                            'repeats': len(positions),
                            'span': span,
                            'score': len(positions) * length,  # longer + more repeats = higher score
                        })

        # Deduplicate: remove patterns that are substrings of longer patterns
        filtered = []
        for p in sorted(patterns, key=lambda x: -x['score']):
            is_sub = False
            for f in filtered:
                if (tuple(p['sequence']) in
                        [tuple(f['sequence'][i:i+len(p['sequence'])])
                         for i in range(len(f['sequence']) - len(p['sequence']) + 1)]):
                    is_sub = True
                    break
            if not is_sub:
                filtered.append(p)

        return filtered[:3]  # Top 3 most significant patterns

    def check(self, receipts_dir: Path) -> list:
        """Main entry: analyze recent receipts, return crystallization hints.

        Returns a list of hint dicts. Returns empty list if no new patterns
        detected or in cooldown. Hints are stored persistently and consumed
        by the controller's review cycle (dream), not the main action loop.
        """
        tools = self._recent_tools(receipts_dir)
        if not tools:
            return []

        patterns = self.detect_patterns(tools)
        if not patterns:
            # Clear stale hint file if pattern is no longer repeating
            if self.hint_path.exists():
                self.hint_path.unlink()
            return []

        now = self.clock()
        hints = []

        for p in patterns:
            seq_key = '|'.join(p['sequence'])
            last_hint = self._last_hints.get(seq_key, 0)

            # Cooldown: don't re-hint about the same pattern too often
            if now - last_hint < COOLDOWN_SECONDS:
                continue

            hint = {
                'type': 'crystallization_hint',
                'sequence': p['sequence'],
                'repeats': p['repeats'],
                'message': (
                    '你已连续做了 {r} 轮 {seq} 循环。'
                    '如果这个行为模式有价值，考虑用 skill_draft 把它编程为自动技能，'
                    '让它在服务端自动运行（不再需要每步都思考）。'
                    '参考 farm_harvest_replant 的做法。'
                ).format(
                    r=p['repeats'],
                    seq=' → '.join(p['sequence']),
                ),
                'detectedAt': now,
            }
            hints.append(hint)
            self._last_hints[seq_key] = now

        # Persist for the review/dream cycle to consume
        if hints:
            self.hint_path.write_text(
                json.dumps(hints[:MAX_HINTS_PER_TICK], ensure_ascii=False, indent=2) + '\n',
                encoding='utf-8')

        return hints[:MAX_HINTS_PER_TICK]

    def get_pending_hint(self) -> dict | None:
        """Read the last detected hint (for prompt injection by controller)."""
        if not self.hint_path.exists():
            return None
        try:
            hints = json.loads(self.hint_path.read_text(encoding='utf-8'))
            if hints and isinstance(hints, list):
                return hints[0]
            return None
        except (json.JSONDecodeError, OSError):
            return None

    def clear_hint(self):
        """Remove the hint after it's been injected (one-shot)."""
        if self.hint_path.exists():
            self.hint_path.unlink()
