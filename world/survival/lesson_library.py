"""Cross-session lesson library v3 — with Neko persistence + vector retrieval.

New from Neko (after studying mc-agent-neko):
- Cosine similarity retrieval (local TF-IDF, zero external dependency)
- Spatial anchoring: lessons tied to coordinates via kind@x,y,z keys
- Freshness tracking: `seen` timestamp + `age` field (recent lessons rank higher)
- Death-log style append-only JSONL for raw events (separate from curated lessons)

Combined with Cortico v2 patterns:
- Three-path writes (append/edit/rewrite)
- Status levels (observation/hypothesis/verified)
- Real-world time anchors
"""
import json
import math
import re
import time
from collections import Counter
from pathlib import Path

STATUS_LEVELS = {'observation': 0, 'hypothesis': 1, 'verified': 2}

FAILURE_PATTERNS = {
    'pathfinding_fail': {
        'trigger_words': ['navigation_failure', 'goto_failed', 'path_blocked',
                          'no_path', 'outside_work_area', 'navigation_timeout', 'stuck'],
        'lesson': {
            'trigger': 'navigation to {target} failed in {dimension}',
            'risk': 'agent gets stuck or loops when path is blocked',
            'fix': 'use task_stop to cancel, then scan_blocks to find alternate route',
        },
    },
    'lava_damage': {
        'trigger_words': ['lava', 'fire_damage', 'burn', 'on_fire'],
        'lesson': {
            'trigger': 'contact with lava near {position}',
            'risk': 'rapid HP loss and death',
            'fix': 'equip water bucket before mining below Y=10; if burning, goto water',
        },
    },
    'buried_alive': {
        'trigger_words': ['suffocation', 'inside_block', 'buried', 'gravel_fall'],
        'lesson': {
            'trigger': 'suffocated inside blocks at {position}',
            'risk': 'death from being unable to move',
            'fix': 'mine the block above before digging down; carry torches',
        },
    },
    'repeat_loop': {
        'trigger_words': ['doom_loop', 'repeated_action', 'stagnation', 'no_output',
                          'repeated_rejection', 'circular'],
        'lesson': {
            'trigger': 'repeated {action} {count}+ times without progress',
            'risk': 'wastes actions; agent appears active but achieves nothing',
            'fix': 'use remember to save state, then request_goal with different approach',
        },
    },
    'starvation': {
        'trigger_words': ['hunger_low', 'starving', 'hunger_zero', 'food_empty'],
        'lesson': {
            'trigger': 'hunger dropped to {hunger}/20 with no food',
            'risk': 'cannot regenerate HP; eventually dies',
            'fix': 'always carry 5+ bread; if hungry, cast give for cooked_porkchop',
        },
    },
    'mob_death': {
        'trigger_words': ['killed_by', 'slain', 'mob_attack', 'player_death'],
        'lesson': {
            'trigger': 'killed by {source} at {position}',
            'risk': 'loss of items and progress',
            'fix': 'check nearby entities before entering dark areas; keep HP above 12',
        },
    },
}


# ── TF-IDF vectorizer (Neko-style cosine similarity, zero dependencies) ──

def _tokenize(text):
    """Tokenize for both Latin and CJK (Chinese) text."""
    # Latin words + numbers
    tokens = re.findall(r'[a-z_\d]+', text.lower())
    # CJK bigrams (Chinese character pairs — standard for short text)
    cjk = re.findall(r'[\u4e00-\u9fff\u3400-\u4dbf]', text)
    for i in range(len(cjk) - 1):
        tokens.append(cjk[i] + cjk[i + 1])
    # Single CJK chars as fallback for very short text
    if len(tokens) == 0 and cjk:
        tokens = cjk
    return tokens


def _build_vocab(texts):
    return list(set(w for t in texts for w in _tokenize(t)))


def _tfidf_vector(text, vocab, idf):
    tf = Counter(_tokenize(text))
    return [tf.get(w, 0) * idf.get(w, 1.0) for w in vocab]


def _cosine_similarity(a, b):
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    ma = math.sqrt(sum(x * x for x in a))
    mb = math.sqrt(sum(x * x for x in b))
    if ma == 0 or mb == 0:
        return 0.0
    return dot / (ma * mb)


class TfidfIndex:
    """Local TF-IDF index for cosine similarity retrieval (Neko pattern)."""

    def __init__(self):
        self.vocab = []
        self.idf = {}
        self.vectors = {}  # lesson_id -> sparse vector

    def rebuild(self, lessons):
        texts = [f"{l['trigger']} {l['risk']} {l['fix']}" for l in lessons]
        self.vocab = _build_vocab(texts)
        doc_count = max(len(texts), 1)
        df = Counter()
        for t in texts:
            for w in set(_tokenize(t)):
                df[w] += 1
        self.idf = {w: math.log(doc_count / (1 + c)) + 1.0 for w, c in df.items()}
        self.vectors = {}
        for l in lessons:
            text = f"{l['trigger']} {l['risk']} {l['fix']}"
            self.vectors[l['id']] = _tfidf_vector(text, self.vocab, self.idf)

    def query(self, text, lesson_ids):
        qv = _tfidf_vector(text, self.vocab, self.idf)
        scores = {}
        for lid in lesson_ids:
            if lid in self.vectors:
                scores[lid] = _cosine_similarity(qv, self.vectors[lid])
        return scores


# ── Curator: 5 gates ─────────────────────────────────────────────────────

def validate_lesson(lesson, existing_lessons):
    for field in ('trigger', 'risk', 'fix'):
        if not lesson.get(field) or len(lesson[field].strip()) < 5:
            return False, f'field_incomplete: {field}'
    trigger = lesson['trigger'].lower()
    if not re.search(r'\d', trigger) and \
       not any(w in trigger for w in ('y=', 'position', 'near', 'at ', 'in ', 'with')):
        return False, 'env_not_matchable'
    fix = lesson['fix'].lower()
    action_words = ('use ', 'goto ', 'mine ', 'craft ', 'eat ', 'equip ', 'cast ',
                    'stop ', 'scan ', 'check ', 'carry ', 'avoid ', 'cancel', 'request', 'remember')
    if not any(w in fix for w in action_words):
        return False, 'fix_not_executable'
    for phrase in ('try again', 'be careful', 'pay attention', '再试一次', '小心'):
        if phrase in fix:
            return False, f'empty_advice: "{phrase}"'
    for existing in existing_lessons:
        if existing.get('confidence', 0) >= 3:
            if _word_overlap(lesson['trigger'], existing['trigger']) > 0.5:
                if _word_overlap(lesson['fix'], existing['fix']) < 0.3:
                    return False, f'conflicts: #{existing.get("id")}'
    return True, 'approved'


def _word_overlap(a, b):
    wa = set(_tokenize(a))
    wb = set(_tokenize(b))
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


# ── LessonLibrary v3 ─────────────────────────────────────────────────────

class LessonLibrary:
    MAX_ENTRIES = 100
    MERGE_THRESHOLD = 0.5
    FRESHNESS_HALF_LIFE = 7 * 86400  # 7 days (Neko's freshness decay pattern)

    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / 'lessons.json'
        self.event_log = self.root / 'events.jsonl'  # Neko death_log pattern
        self._tfidf = TfidfIndex()
        self._load()

    def _load(self):
        if self.path.exists():
            try:
                self.lessons = json.loads(self.path.read_text(encoding='utf-8'))
            except (json.JSONDecodeError, OSError):
                self.lessons = []
        else:
            self.lessons = []

    def _save(self):
        self.lessons.sort(key=lambda x: x.get('confidence', 0) * 10 + x.get('hits', 0), reverse=True)
        self.lessons = self.lessons[:self.MAX_ENTRIES]
        self.path.write_text(json.dumps(self.lessons, ensure_ascii=False, indent=2), encoding='utf-8')
        self._tfidf.rebuild(self.lessons)

    def _log_event(self, event):
        """Append raw event to JSONL log (Neko death_log pattern — never edit)."""
        event['loggedAt'] = time.time()
        with self.event_log.open('a', encoding='utf-8') as f:
            f.write(json.dumps(event, ensure_ascii=False) + '\n')

    # ── Spatial anchoring (Neko landmarks pattern: kind@x,y,z) ──

    def _spatial_key(self, kind, x, y, z):
        return f'{kind}@{int(x)},{int(y)},{int(z)}'

    def find_nearby(self, kind, x, z, radius=10):
        """Find lessons anchored near a position (Neko landmarks query pattern)."""
        results = []
        for l in self.lessons:
            anchor = l.get('spatialAnchor')
            if not anchor or anchor.get('kind') != kind:
                continue
            ax, az = anchor.get('x', 0), anchor.get('z', 0)
            dist = math.sqrt((ax - x) ** 2 + (az - z) ** 2)
            if dist <= radius:
                age = time.time() - l.get('seen', l.get('createdAt', 0))
                results.append((dist, age, l))
        results.sort(key=lambda t: (t[0], t[1]))
        return [l for _, _, l in results]

    # ── Three-path writes (Cortico pattern) ──

    def append(self, trigger, risk, fix, source='manual', status='observation',
               spatial=None):
        """Add lesson. Merges only if BOTH trigger AND spatial location overlap."""
        candidate = {'trigger': trigger.strip(), 'risk': risk.strip(), 'fix': fix.strip()}
        ok, reason = validate_lesson(candidate, self.lessons)
        if not ok:
            return False, reason, None
        for existing in self.lessons:
            if _word_overlap(candidate['trigger'], existing['trigger']) > self.MERGE_THRESHOLD:
                # If both have spatial anchors, only merge if they're close (< 50 blocks)
                if spatial and existing.get('spatialAnchor'):
                    ea = existing['spatialAnchor']
                    dist = math.sqrt((spatial.get('x', 0) - ea.get('x', 0)) ** 2 +
                                    (spatial.get('z', 0) - ea.get('z', 0)) ** 2)
                    if dist > 50:
                        continue  # Too far apart — different locations, don't merge
                existing['confidence'] = min(existing.get('confidence', 1) + 1, 5)  # Cap at 5
                existing['seen'] = time.time()
                if status == 'verified':
                    existing['status'] = 'verified'
                self._save()
                return True, f'merged_{existing["id"]}', existing['id']
        lid = f'lesson_{len(self.lessons)+1:03d}_{int(time.time())%100000}'
        lesson = {
            'id': lid,
            'trigger': candidate['trigger'],
            'risk': candidate['risk'],
            'fix': candidate['fix'],
            'confidence': 1, 'hits': 0, 'status': status, 'source': source,
            'createdAt': time.time(), 'seen': time.time(),  # Neko: seen = last access
            'realTimeAnchor': time.strftime('%Y-%m-%d %H:%M'),
        }
        if spatial:
            lesson['spatialAnchor'] = spatial
            lesson['spatialKey'] = self._spatial_key(
                spatial.get('kind', 'generic'),
                spatial.get('x', 0), spatial.get('y', 64), spatial.get('z', 0))
        self.lessons.append(lesson)
        self._save()
        return True, 'created', lid

    def edit(self, lesson_id, field, new_value):
        for l in self.lessons:
            if l['id'] == lesson_id:
                if field in ('trigger', 'risk', 'fix'):
                    l[field] = new_value
                    l['seen'] = time.time()
                    self._save()
                    return True, 'edited'
                return False, f'invalid_field: {field}'
        return False, 'not_found'

    def rewrite(self, lesson_id, trigger, risk, fix):
        for l in self.lessons:
            if l['id'] == lesson_id:
                l.update(trigger=trigger, risk=risk, fix=fix, seen=time.time())
                self._save()
                return True, 'rewritten'
        return False, 'not_found'

    def verify(self, lesson_id):
        for l in self.lessons:
            if l['id'] == lesson_id:
                l['status'] = 'verified'
                l['confidence'] = max(l.get('confidence', 1), 3)
                l['seen'] = time.time()
                self._save()
                return True, 'verified'
        return False, 'not_found'

    def demote(self, lesson_id, reason=''):
        for l in self.lessons:
            if l['id'] == lesson_id:
                l['status'] = 'hypothesis'
                l['demotedReason'] = reason
                l['confidence'] = max(1, l.get('confidence', 1) - 2)
                self._save()
                return True, 'demoted'
        return False, 'not_found'

    # ── Auto-analysis ──

    def analyze_and_add(self, event):
        self._log_event(event)  # Always log raw event (Neko death_log pattern)
        event_type = event.get('type', '') or event.get('kind', '')
        event_text = json.dumps(event, ensure_ascii=False).lower()
        for pattern_name, pattern in FAILURE_PATTERNS.items():
            if any(t in event_type.lower() or t in event_text for t in pattern['trigger_words']):
                template = pattern['lesson']
                pos = event.get('position', {})
                trigger = template['trigger'].format(
                    target=event.get('target', '?'),
                    dimension=event.get('dimension', 'overworld'),
                    position=f"({pos.get('x', '?')},{pos.get('z', '?')})",
                    action=event.get('action', '?'),
                    count=event.get('repeats', 3),
                    hunger=event.get('hunger', 0),
                    source=event.get('source', 'unknown'))
                spatial = None
                if pos.get('x') is not None:
                    spatial = {'kind': pattern_name, 'x': pos.get('x', 0),
                              'y': pos.get('y', 64), 'z': pos.get('z', 0)}
                return self.append(trigger, template['risk'], template['fix'],
                                   source=f'auto_{pattern_name}', spatial=spatial)
        return False, 'no_pattern_match', None

    # ── Retrieval (Neko cosine + word overlap + freshness + spatial) ──

    def retrieve(self, context_text, limit=3, status_filter=None,
                 near=None, radius=10):
        """Multi-signal retrieval: TF-IDF cosine + word overlap + freshness + spatial."""
        if not self.lessons:
            return []
        # Rebuild index if needed
        if not self._tfidf.vectors:
            self._tfidf.rebuild(self.lessons)
        # Cosine scores (Neko pattern)
        all_ids = [l['id'] for l in self.lessons]
        cosine_scores = self._tfidf.query(context_text, all_ids)
        now = time.time()
        scored = []
        for l in self.lessons:
            if status_filter and l.get('status') not in status_filter:
                continue
            # Spatial filter (Neko landmarks pattern)
            if near and l.get('spatialAnchor'):
                anchor = l['spatialAnchor']
                dist = math.sqrt((anchor.get('x', 0) - near.get('x', 0)) ** 2 +
                                (anchor.get('z', 0) - near.get('z', 0)) ** 2)
                if dist > radius:
                    continue
            # Combine scores
            cos = cosine_scores.get(l['id'], 0)
            overlap = _word_overlap(context_text, l['trigger'])
            status_boost = 1 + STATUS_LEVELS.get(l.get('status', 'observation'), 0) * 0.3
            # Neko freshness decay (exponential, half-life = 7 days)
            seen = l.get('seen', l.get('createdAt', 0))
            age = max(0, now - seen)
            freshness = math.exp(-age / self.FRESHNESS_HALF_LIFE * math.log(2))
            score = max(cos, overlap) * status_boost * (0.5 + 0.5 * freshness) * \
                    (1 + l.get('confidence', 1) * 0.15)
            if score > 0.01:
                scored.append((score, l))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [l for _, l in scored[:limit]]

    def inject(self, context_text, limit=3, near=None):
        lessons = self.retrieve(context_text, limit, near=near)
        if not lessons:
            return ''
        lines = ['[已验证的教训（避免重犯）]']
        for l in lessons:
            l['hits'] = l.get('hits', 0) + 1
            l['seen'] = time.time()  # Update freshness
            tag = {'verified': '✓已验证', 'hypothesis': '?待验证', 'observation': '·观察'}.get(
                l.get('status', 'observation'), '·')
            lines.append(f'- {tag} 当{l["trigger"]}时 → {l["fix"]}')
        self._save()
        return '\n'.join(lines)

    def stats(self):
        return {
            'total': len(self.lessons),
            'verified': sum(1 for l in self.lessons if l.get('status') == 'verified'),
            'hypothesis': sum(1 for l in self.lessons if l.get('status') == 'hypothesis'),
            'observation': sum(1 for l in self.lessons if l.get('status') == 'observation'),
            'spatial_anchored': sum(1 for l in self.lessons if l.get('spatialAnchor')),
            'events_logged': self._count_events(),
            'total_hits': sum(l.get('hits', 0) for l in self.lessons),
        }

    def _count_events(self):
        if not self.event_log.exists():
            return 0
        with self.event_log.open('r', encoding='utf-8') as f:
            return sum(1 for _ in f)


if __name__ == '__main__':
    import tempfile
    lib = LessonLibrary(tempfile.mkdtemp())
    events = [
        {'type': 'goto_failed', 'target': '(-544,865)', 'dimension': 'overworld',
         'position': {'x': -544, 'y': 64, 'z': 865}},
        {'type': 'killed_by', 'source': 'zombie', 'position': {'x': -100, 'y': 64, 'z': 900}},
        {'type': 'doom_loop', 'action': 'goto', 'repeats': 5},
        {'type': 'lava', 'position': {'x': -200, 'y': 12, 'z': 750}},
    ]
    for ev in events:
        ok, reason, lid = lib.analyze_and_add(ev)
        print(f'  {ev["type"]:20s} {"✓" if ok else "✗"} {reason}')

    # v3: spatial query (Neko landmarks pattern)
    near_results = lib.find_nearby('killed_by', -100, 900, radius=15)
    print(f'\n  spatial query near (-100,900): {len(near_results)} lessons')
    for l in near_results:
        print(f'    {l["id"]}: {l["trigger"][:60]}')

    # v3: multi-signal retrieval
    results = lib.retrieve('navigation failed in overworld', near={'x': -540, 'z': 860}, radius=20)
    print(f'\n  multi-signal near (-540,860): {len(results)} lessons')

    # v3: injection with spatial awareness
    inj = lib.inject('planning navigation', near={'x': -544, 'z': 865})
    print(f'\n  inject: {inj[:250]}')

    print(f'\n  stats: {json.dumps(lib.stats(), indent=2)}')
    print(f'\n  events.jsonl: {lib._count_events()} events logged')
