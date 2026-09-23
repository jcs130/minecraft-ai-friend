"""Cross-session lesson library: learn from failures, inject into next prompt.

Architecture (adapted from corti/MineEvolve, arXiv 2603.13131):

  Event analyzer → 6 failure patterns → candidate lesson
  Curator → 5 validation gates → accept or reject (with reason)
  KnowledgeBase → JSON persistence → merge/retrieve/inject

This replaces nothing in the existing memory system; it adds a
failure-specific knowledge layer that survives restarts.
"""
import json
import os
import re
import time
from pathlib import Path

# ── Failure patterns (event → lesson template) ─────────────────────────

FAILURE_PATTERNS = {
    'pathfinding_fail': {
        'trigger': ['navigation_failure', 'goto_failed', 'path_blocked', 'no_path',
                    'outside_work_area', 'navigation_timeout', 'stuck'],
        'lesson': {
            'trigger': 'navigation to {target} failed in {dimension}',
            'risk': 'agent gets stuck or loops when path is blocked',
            'fix': 'use task_stop to cancel, then scan_blocks to find alternate route, or goto a waypoint 10 blocks away from the blockage',
        },
    },
    'lava_damage': {
        'trigger': ['lava', 'fire_damage', 'burn', 'on_fire'],
        'lesson': {
            'trigger': 'contact with lava near {position}',
            'risk': 'rapid HP loss and death',
            'fix': 'equip water bucket in offhand before mining below Y=10; if already burning, goto nearest water or use heal spell',
        },
    },
    'buried_alive': {
        'trigger': ['suffocation', 'inside_block', 'buried', 'gravel_fall', 'sand_fall'],
        'lesson': {
            'trigger': 'suffocated inside blocks at {position}',
            'risk': 'death from being unable to move',
            'fix': 'mine the block above before digging down; carry torches to prevent gravel/sand collapse',
        },
    },
    'repeat_loop': {
        'trigger': ['doom_loop', 'repeated_action', 'stagnation', 'no_output',
                    'repeated_rejection', 'circular'],
        'lesson': {
            'trigger': 'repeated {action} {count}+ times without progress',
            'risk': 'wastes actions and time; agent appears active but achieves nothing',
            'fix': 'use remember to save current state, then request_goal with a different approach; check if prerequisites are met before repeating',
        },
    },
    'starvation': {
        'trigger': ['hunger_low', 'starving', 'hunger_zero', 'food_empty'],
        'lesson': {
            'trigger': 'hunger dropped to {hunger}/20 with no food in inventory',
            'risk': 'cannot regenerate HP; eventually dies from starvation',
            'fix': 'always carry 5+ bread; if hungry with no food, cast give for cooked_porkchop or buy from villager; check hunger before starting long tasks',
        },
    },
    'mob_death': {
        'trigger': ['killed_by', 'slain', 'mob_attack', 'player_death', 'pvp_death'],
        'lesson': {
            'trigger': 'killed by {source} at {position}',
            'risk': 'loss of items and progress',
            'fix': 'check nearby entities with scan before entering dark areas; keep HP above 12; equip sword when hostiles detected; build 3-block pillar to escape melee',
        },
    },
}

# ── Curator: 5-gate validation ──────────────────────────────────────────

def validate_lesson(lesson, existing_lessons):
    """Return (ok, reason). Five gates, reject on first failure."""
    # Gate 1: Field completeness
    for field in ('trigger', 'risk', 'fix'):
        if not lesson.get(field) or not isinstance(lesson[field], str) or len(lesson[field].strip()) < 5:
            return False, f'field_incomplete: {field} missing or too short'

    # Gate 2: Environment matchable (trigger mentions concrete things)
    trigger = lesson['trigger'].lower()
    if not any(w in trigger for w in ('y=', 'position', 'near', 'at', 'in ', 'with', 'during', 'below', 'above')):
        if not any(re.search(r'\d', trigger) for _ in [trigger]):
            return False, 'env_not_matchable: trigger has no concrete context'

    # Gate 3: Fix action executable (contains actionable words)
    fix = lesson['fix'].lower()
    action_words = ('use ', 'goto ', 'mine ', 'craft ', 'eat ', 'equip ', 'cast ', 'stop ',
                    'scan ', 'check ', 'build ', 'place ', 'carry ', 'avoid ', 'equip',
                    'cancel', 'request', 'remember')
    if not any(fix.contains(w.strip()) if hasattr(fix, 'contains') else w in fix for w in action_words):
        return False, 'fix_not_executable: no concrete action word'

    # Gate 4: Reject empty advice
    empty_phrases = ('try again', 'be careful', 'pay attention', 'do better',
                     '再试一次', '小心', '注意')
    for phrase in empty_phrases:
        if phrase in fix:
            return False, f'empty_advice: contains "{phrase}"'

    # Gate 5: No conflict with high-confidence entries
    for existing in existing_lessons:
        if existing.get('confidence', 0) >= 3:
            if _word_overlap(lesson['trigger'], existing['trigger']) > 0.5:
                if _word_overlap(lesson['fix'], existing['fix']) < 0.3:
                    return False, f'conflicts_with_high_confidence: overlaps trigger of #{existing.get("id","?")} but different fix'

    return True, 'approved'


def _word_overlap(a, b):
    """Jaccard similarity of word sets."""
    wa = set(re.findall(r'[a-z_\d]+', a.lower()))
    wb = set(re.findall(r'[a-z_\d]+', b.lower()))
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


# ── KnowledgeBase ────────────────────────────────────────────────────────

class LessonLibrary:
    MAX_ENTRIES = 100
    MERGE_THRESHOLD = 0.5

    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / 'lessons.json'
        self._load()

    def _load(self):
        if self.path.exists():
            try:
                data = json.loads(self.path.read_text(encoding='utf-8'))
                self.lessons = data if isinstance(data, list) else []
            except (json.JSONDecodeError, OSError):
                self.lessons = []
        else:
            self.lessons = []

    def _save(self):
        # Sort by confidence*10 + hits, keep top MAX_ENTRIES
        self.lessons.sort(key=lambda x: x.get('confidence', 0) * 10 + x.get('hits', 0), reverse=True)
        self.lessons = self.lessons[:self.MAX_ENTRIES]
        self.path.write_text(json.dumps(self.lessons, ensure_ascii=False, indent=2), encoding='utf-8')

    def add(self, trigger, risk, fix, source='manual'):
        """Add a lesson. Returns (ok, reason, lesson_id_or_None)."""
        candidate = {'trigger': trigger.strip(), 'risk': risk.strip(), 'fix': fix.strip()}
        ok, reason = validate_lesson(candidate, self.lessons)
        if not ok:
            return False, reason, None

        # Try merge with existing
        for existing in self.lessons:
            if _word_overlap(candidate['trigger'], existing['trigger']) > self.MERGE_THRESHOLD:
                existing['confidence'] = existing.get('confidence', 1) + 1
                existing['lastMerged'] = time.time()
                self._save()
                return True, f'merged_with_{existing["id"]}', existing['id']

        # New entry
        lesson_id = f'lesson_{len(self.lessons)+1:03d}_{int(time.time())%100000}'
        lesson = {
            'id': lesson_id,
            'trigger': candidate['trigger'],
            'risk': candidate['risk'],
            'fix': candidate['fix'],
            'confidence': 1,
            'hits': 0,
            'source': source,
            'createdAt': time.time(),
        }
        self.lessons.append(lesson)
        self._save()
        return True, 'created', lesson_id

    def analyze_and_add(self, event):
        """Analyze a failure event and auto-generate a lesson if pattern matches."""
        event_type = event.get('type', '') or event.get('kind', '')
        event_text = json.dumps(event, ensure_ascii=False).lower()

        for pattern_name, pattern in FAILURE_PATTERNS.items():
            if any(t in event_type.lower() or t in event_text for t in pattern['trigger']):
                template = pattern['lesson']
                trigger = template['trigger'].format(
                    target=event.get('target', event.get('args', {}).get('x', '?')),
                    dimension=event.get('dimension', 'overworld'),
                    position=f"({event.get('position', {}).get('x', '?')},{event.get('position', {}).get('z', '?')})",
                    action=event.get('action', event.get('tool', '?')),
                    count=event.get('repeats', 3),
                    hunger=event.get('hunger', 0),
                    source=event.get('source', event.get('cause', 'unknown')),
                )
                return self.add(trigger, template['risk'], template['fix'], source=f'auto_{pattern_name}')

        return False, 'no_pattern_match', None

    def retrieve(self, context_text, limit=3):
        """Find relevant lessons for a given context, sorted by overlap*confidence."""
        if not self.lessons:
            return []
        scored = []
        for lesson in self.lessons:
            overlap = _word_overlap(context_text, lesson['trigger'])
            if overlap > 0.05:
                score = overlap * (1 + lesson.get('confidence', 1) * 0.3)
                scored.append((score, lesson))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [l for _, l in scored[:limit]]

    def inject(self, context_text, limit=3):
        """Generate prompt-injectable text from relevant lessons."""
        lessons = self.retrieve(context_text, limit)
        if not lessons:
            return ''
        lines = ['[已验证的教训（避免重犯）]']
        for lesson in lessons:
            lesson['hits'] = lesson.get('hits', 0) + 1
            lines.append(f"- 当{lesson['trigger']}时：{lesson['risk']}。{lesson['fix']}。")
        self._save()
        return '\n'.join(lines)

    def stats(self):
        return {
            'total': len(self.lessons),
            'high_confidence': sum(1 for l in self.lessons if l.get('confidence', 0) >= 3),
            'total_hits': sum(l.get('hits', 0) for l in self.lessons),
            'by_source': dict(sorted(
                (src, sum(1 for l in self.lessons if l.get('source', '').startswith(src)))
                for src in set(l.get('source', '?').split('_')[0] for l in self.lessons)
            )),
        }


if __name__ == '__main__':
    import tempfile
    lib = LessonLibrary(tempfile.mkdtemp())

    # Test auto-analysis
    events = [
        {'type': 'goto_failed', 'target': '(-544,865)', 'dimension': 'overworld'},
        {'type': 'killed_by', 'source': 'zombie', 'position': {'x': -100, 'z': 900}},
        {'type': 'doom_loop', 'action': 'goto', 'repeats': 5},
    ]
    for ev in events:
        ok, reason, lid = lib.analyze_and_add(ev)
        print(f'  {ev["type"]:20s} → {"✓" if ok else "✗"} {reason}')

    # Test retrieval & injection
    context = 'planning navigation to (-544,865) in overworld'
    injected = lib.inject(context)
    print(f'\n  inject for "{context[:40]}...":')
    print(f'  {injected[:200]}')
    print(f'\n  stats: {lib.stats()}')
