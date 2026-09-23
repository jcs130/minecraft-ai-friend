"""Cross-session lesson library v2 — with Cortico-inspired improvements.

Changes from v1 (after studying Cortico's memory system):
- Three-path writes: append (log), edit (fix one line), rewrite (distill)
- Entry status: observation / hypothesis / verified
- First-line summary for prompt injection (like viewers/<id>.md)
- No version control yet (Git integration is future work)
- One fact, one place: merge strictly by overlap
- Real-world time anchors (not game ticks)

Adapted from corti/MineEvolve (arXiv 2603.13131) + Cortico cormini memory.
"""
import json
import re
import time
from pathlib import Path

STATUS_LEVELS = {'observation': 0, 'hypothesis': 1, 'verified': 2}
WRITE_MODES = ('append', 'edit', 'rewrite')

# ── Failure patterns ─────────────────────────────────────────────────────

FAILURE_PATTERNS = {
    'pathfinding_fail': {
        'trigger_words': ['navigation_failure', 'goto_failed', 'path_blocked',
                          'no_path', 'outside_work_area', 'navigation_timeout', 'stuck'],
        'lesson': {
            'trigger': 'navigation to {target} failed in {dimension}',
            'risk': 'agent gets stuck or loops when path is blocked',
            'fix': 'use task_stop to cancel, then scan_blocks to find alternate route, or goto a nearby waypoint',
        },
    },
    'lava_damage': {
        'trigger_words': ['lava', 'fire_damage', 'burn', 'on_fire'],
        'lesson': {
            'trigger': 'contact with lava near {position}',
            'risk': 'rapid HP loss and death',
            'fix': 'equip water bucket in offhand before mining below Y=10; if burning, goto nearest water',
        },
    },
    'buried_alive': {
        'trigger_words': ['suffocation', 'inside_block', 'buried', 'gravel_fall'],
        'lesson': {
            'trigger': 'suffocated inside blocks at {position}',
            'risk': 'death from being unable to move',
            'fix': 'mine the block above before digging down; carry torches to prevent collapse',
        },
    },
    'repeat_loop': {
        'trigger_words': ['doom_loop', 'repeated_action', 'stagnation', 'no_output',
                          'repeated_rejection', 'circular'],
        'lesson': {
            'trigger': 'repeated {action} {count}+ times without progress',
            'risk': 'wastes actions and time; agent appears active but achieves nothing',
            'fix': 'use remember to save state, then request_goal with different approach',
        },
    },
    'starvation': {
        'trigger_words': ['hunger_low', 'starving', 'hunger_zero', 'food_empty'],
        'lesson': {
            'trigger': 'hunger dropped to {hunger}/20 with no food in inventory',
            'risk': 'cannot regenerate HP; eventually dies',
            'fix': 'always carry 5+ bread; if hungry with no food, cast give for cooked_porkchop',
        },
    },
    'mob_death': {
        'trigger_words': ['killed_by', 'slain', 'mob_attack', 'player_death'],
        'lesson': {
            'trigger': 'killed by {source} at {position}',
            'risk': 'loss of items and progress',
            'fix': 'check nearby entities before entering dark areas; keep HP above 12; equip sword',
        },
    },
}


# ── Curator: 5 gates ─────────────────────────────────────────────────────

def validate_lesson(lesson, existing_lessons):
    for field in ('trigger', 'risk', 'fix'):
        if not lesson.get(field) or not isinstance(lesson[field], str) or len(lesson[field].strip()) < 5:
            return False, f'field_incomplete: {field}'
    trigger = lesson['trigger'].lower()
    if not any(re.search(r'\d', trigger) for _ in [trigger]) and \
       not any(w in trigger for w in ('y=', 'position', 'near', 'at ', 'in ', 'with', 'during')):
        return False, 'env_not_matchable: trigger has no concrete context'
    fix = lesson['fix'].lower()
    action_words = ('use ', 'goto ', 'mine ', 'craft ', 'eat ', 'equip ', 'cast ',
                    'stop ', 'scan ', 'check ', 'build ', 'place ', 'carry ',
                    'avoid ', 'cancel', 'request', 'remember', 'goto')
    if not any(w in fix for w in action_words):
        return False, 'fix_not_executable: no concrete action word'
    for phrase in ('try again', 'be careful', 'pay attention', 'do better',
                   '再试一次', '小心', '注意'):
        if phrase in fix:
            return False, f'empty_advice: contains "{phrase}"'
    for existing in existing_lessons:
        if existing.get('confidence', 0) >= 3:
            if _word_overlap(lesson['trigger'], existing['trigger']) > 0.5:
                if _word_overlap(lesson['fix'], existing['fix']) < 0.3:
                    return False, f'conflicts_with_high_confidence: overlaps #{existing.get("id","?")}'
    return True, 'approved'


def _word_overlap(a, b):
    wa = set(re.findall(r'[a-z_\d]+', a.lower()))
    wb = set(re.findall(r'[a-z_\d]+', b.lower()))
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


# ── LessonLibrary ────────────────────────────────────────────────────────

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
                self.lessons = json.loads(self.path.read_text(encoding='utf-8'))
                if not isinstance(self.lessons, list):
                    self.lessons = []
            except (json.JSONDecodeError, OSError):
                self.lessons = []
        else:
            self.lessons = []

    def _save(self):
        self.lessons.sort(key=lambda x: x.get('confidence', 0) * 10 + x.get('hits', 0), reverse=True)
        self.lessons = self.lessons[:self.MAX_ENTRIES]
        self.path.write_text(json.dumps(self.lessons, ensure_ascii=False, indent=2), encoding='utf-8')

    # ── Three-path writes (Cortico pattern) ──

    def append(self, trigger, risk, fix, source='manual', status='observation'):
        """Add a new lesson (log-style: one fact forward, never overwrite)."""
        candidate = {'trigger': trigger.strip(), 'risk': risk.strip(), 'fix': fix.strip()}
        ok, reason = validate_lesson(candidate, self.lessons)
        if not ok:
            return False, reason, None
        for existing in self.lessons:
            if _word_overlap(candidate['trigger'], existing['trigger']) > self.MERGE_THRESHOLD:
                existing['confidence'] = existing.get('confidence', 1) + 1
                if status == 'verified' and existing.get('status') != 'verified':
                    existing['status'] = 'verified'
                existing['lastMerged'] = time.time()
                self._save()
                return True, f'merged_with_{existing["id"]}', existing['id']
        lesson_id = f'lesson_{len(self.lessons)+1:03d}_{int(time.time())%100000}'
        lesson = {
            'id': lesson_id,
            'trigger': candidate['trigger'],
            'risk': candidate['risk'],
            'fix': candidate['fix'],
            'confidence': 1,
            'hits': 0,
            'status': status,
            'source': source,
            'createdAt': time.time(),
            'realTimeAnchor': time.strftime('%Y-%m-%d %H:%M', time.localtime()),
        }
        self.lessons.append(lesson)
        self._save()
        return True, 'created', lesson_id

    def edit(self, lesson_id, field, new_value):
        """Fix one field of an existing lesson (edit-in-place, like edit_file)."""
        for lesson in self.lessons:
            if lesson['id'] == lesson_id:
                if field in ('trigger', 'risk', 'fix'):
                    lesson[field] = new_value
                    lesson['editedAt'] = time.time()
                    self._save()
                    return True, 'edited'
                return False, f'invalid_field: {field}'
        return False, 'lesson_not_found'

    def rewrite(self, lesson_id, trigger, risk, fix):
        """Full rewrite (distill/restructure, like write_file)."""
        for lesson in self.lessons:
            if lesson['id'] == lesson_id:
                lesson['trigger'] = trigger
                lesson['risk'] = risk
                lesson['fix'] = fix
                lesson['rewrittenAt'] = time.time()
                self._save()
                return True, 'rewritten'
        return False, 'lesson_not_found'

    def verify(self, lesson_id):
        """Promote a lesson to 'verified' status (like Cortico's fact verification)."""
        for lesson in self.lessons:
            if lesson['id'] == lesson_id:
                lesson['status'] = 'verified'
                lesson['confidence'] = max(lesson.get('confidence', 1), 3)
                self._save()
                return True, 'verified'
        return False, 'lesson_not_found'

    def demote(self, lesson_id, reason=''):
        """Demote to 'hypothesis' (evidence contradicted it)."""
        for lesson in self.lessons:
            if lesson['id'] == lesson_id:
                lesson['status'] = 'hypothesis'
                lesson['demotedReason'] = reason
                lesson['confidence'] = max(1, lesson.get('confidence', 1) - 2)
                self._save()
                return True, 'demoted'
        return False, 'lesson_not_found'

    # ── Auto-analysis ──

    def analyze_and_add(self, event):
        event_type = event.get('type', '') or event.get('kind', '')
        event_text = json.dumps(event, ensure_ascii=False).lower()
        for pattern_name, pattern in FAILURE_PATTERNS.items():
            if any(t in event_type.lower() or t in event_text for t in pattern['trigger_words']):
                template = pattern['lesson']
                trigger = template['trigger'].format(
                    target=event.get('target', '?'),
                    dimension=event.get('dimension', 'overworld'),
                    position=f"({event.get('position', {}).get('x', '?')},{event.get('position', {}).get('z', '?')})",
                    action=event.get('action', '?'),
                    count=event.get('repeats', 3),
                    hunger=event.get('hunger', 0),
                    source=event.get('source', 'unknown'),
                )
                return self.append(trigger, template['risk'], template['fix'],
                                   source=f'auto_{pattern_name}')
        return False, 'no_pattern_match', None

    # ── Retrieval & Injection ──

    def retrieve(self, context_text, limit=3, status_filter=None):
        if not self.lessons:
            return []
        scored = []
        for lesson in self.lessons:
            if status_filter and lesson.get('status') not in status_filter:
                continue
            overlap = _word_overlap(context_text, lesson['trigger'])
            if overlap > 0.03:
                status_boost = 1 + STATUS_LEVELS.get(lesson.get('status', 'observation'), 0) * 0.3
                score = overlap * (1 + lesson.get('confidence', 1) * 0.2) * status_boost
                scored.append((score, lesson))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [l for _, l in scored[:limit]]

    def inject(self, context_text, limit=3):
        """Generate prompt text with first-line summaries (Cortico viewers pattern)."""
        lessons = self.retrieve(context_text, limit)
        if not lessons:
            return ''
        lines = ['[已验证的教训（避免重犯）]']
        for lesson in lessons:
            lesson['hits'] = lesson.get('hits', 0) + 1
            status_tag = {'verified': '✓已验证', 'hypothesis': '?待验证', 'observation': '·观察'}.get(
                lesson.get('status', 'observation'), '·')
            lines.append(f'- {status_tag} 当{lesson["trigger"]}时 → {lesson["fix"]}')
        self._save()
        return '\n'.join(lines)

    def stats(self):
        return {
            'total': len(self.lessons),
            'verified': sum(1 for l in self.lessons if l.get('status') == 'verified'),
            'hypothesis': sum(1 for l in self.lessons if l.get('status') == 'hypothesis'),
            'observation': sum(1 for l in self.lessons if l.get('status') == 'observation'),
            'high_confidence': sum(1 for l in self.lessons if l.get('confidence', 0) >= 3),
            'total_hits': sum(l.get('hits', 0) for l in self.lessons),
        }


if __name__ == '__main__':
    import tempfile
    lib = LessonLibrary(tempfile.mkdtemp())

    # v2 features test
    events = [
        {'type': 'goto_failed', 'target': '(-544,865)', 'dimension': 'overworld'},
        {'type': 'killed_by', 'source': 'zombie', 'position': {'x': -100, 'z': 900}},
        {'type': 'doom_loop', 'action': 'goto', 'repeats': 5},
    ]
    for ev in events:
        ok, reason, lid = lib.analyze_and_add(ev)
        print(f'  {ev["type"]:20s} {"✓" if ok else "✗"} {reason}')

    # Three-path writes
    lid = lib.lessons[0]['id']
    print(f'\n  edit: {lib.edit(lid, "fix", "use task_stop then goto shared:1 as fallback")}')
    print(f'  verify: {lib.verify(lid)}')
    print(f'  demote: {lib.demote(lib.lessons[1]["id"], "evidence suggests mob was passive")}')

    # Status-aware injection
    inj = lib.inject('planning navigation in overworld')
    print(f'\n  inject: {inj[:250]}')
    print(f'\n  stats: {json.dumps(lib.stats(), indent=2)}')
