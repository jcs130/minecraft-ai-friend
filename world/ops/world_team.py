"""Shared, attributed project feedback and work handoffs; no model or world calls."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import time
from world_team_hosts import native_inventory

MEMBERS = {
    'game:mc-god': ('灯语女神 · 世界管理', '世界管理员：巡查、响应、分派问题、验收运营结果'),
    'operations:mc-god': ('天神 · 世界工程师', '读取和修改独立源码，隔离测试，提交可审阅修复'),
    'game:qd-guild-planner': ('公会 · 游戏策划', '故事、任务和活动设计，提出可校验的内容包'),
    'game:qd-survivor': ('桐人 · 内测玩家', '真实游玩、复现问题、提交文档反馈、体验复测'),
    'game:mc-herald': ('灯语女神 · 玩家交流', '承接 Goddess 日常传声与玩家对话，记录祈愿和沟通问题，交女神处理'),
    'game:qd-villager-dialogue': ('村民对话', '保留每位村民当前身份和对话契约，反馈村落需求与交互问题'),
    'game:qd-maid-dialogue': ('独立人物对话接口', '保留人物绑定与原生对话格式，把交互和能力问题送入团队'),
    'operations:default': ('司灯 · 项目协调', '追踪工单和日常公会运营，避免重复派工'),
    'operations:mc-herald': ('灯语 · 服务诊断', '分析运行证据，复核故障与恢复情况'),
    'operations:mc-priest': ('灶火祭司 · 剧情顾问', '为策划贡献原作一致的故事和活动想法'),
    'operations:mc-guard-kirito': ('桐人体验官', '技能、法杖和手柄验收方案；不是游戏内桐人的身体'),
    'operations:mc-guard-naruto': ('鸣人体验官', '新手、探索和恢复体验验收'),
}
COORDINATORS = frozenset(('game:mc-god', 'operations:default'))


def members():
    result = dict(MEMBERS)
    manifest = Path(os.environ.get('MAID_ROLES_MANIFEST_FILE', '/maid-roles/roles.json'))
    if manifest.exists():
        if any(p.is_symlink() for p in (manifest, *manifest.parents)) or manifest.stat().st_size > 16384:
            raise ValueError('invalid_team_character_manifest')
        value = json.loads(manifest.read_text(encoding='utf-8-sig'))
        ids = value['activeRoleIds']
        assert value['schema'] == 1 and value['bindingsValid'] is True and value['independentSessions'] is True
        assert len(ids) == len(set(ids)) == value['registeredCount'] and len(ids) <= 64
        for role in ids:
            assert re.fullmatch(r'[A-Za-z0-9_-]{4,64}', role) and 'game:' + role not in MEMBERS
            result['game:' + role] = ('独立人物 · ' + role, '保持自己的姓名、人格、主人和生活会话；真实互动与伙伴协作中反馈问题、按需复测')
        party = Path(os.environ.get('PARTY_ROLES_MANIFEST_FILE', '/party-roles/roles.json'))
        if party.exists():
            if party.is_symlink() or party.stat().st_size > 16384: raise ValueError('invalid_team_party_manifest')
            data = json.loads(party.read_text(encoding='utf-8-sig'))
            for row in data.get('members', []):
                actor = 'game:' + row['agentId']
                if row['agentId'] in ids:
                    result[actor] = (text(row['displayName'], 160, 'character_name'), result[actor][1])
    elif os.environ.get('MAID_ROLES_MANIFEST_FILE'):
        raise ValueError('missing_team_character_manifest')
    return result
STATUSES = frozenset(('open', 'working', 'blocked', 'needs_review', 'resolved', 'duplicate'))
KEY = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{3,119}')


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(encode(value).encode('utf-8')).hexdigest()


def text(value, limit, field):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= limit:
        raise ValueError('invalid_' + field)
    return value.strip()


class TeamStore:
    def __init__(self, actor, root=Path('/team'), clock=time.time):
        if actor not in members():
            raise ValueError('unregistered_team_actor')
        self.actor, self.root, self.clock = actor, Path(root), clock

    @contextmanager
    def db(self):
        if any(p.is_symlink() for p in (self.root, *self.root.parents)):
            raise ValueError('linked_team_root')
        self.root.mkdir(parents=True, exist_ok=True)
        path = self.root / 'team.sqlite3'
        if path.is_symlink(): raise ValueError('linked_team_ledger')
        db = sqlite3.connect(path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            db.execute('BEGIN IMMEDIATE')
            db.execute('CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, author TEXT NOT NULL, '
                'dedupe_key TEXT NOT NULL, owner TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL, '
                'updated_at REAL NOT NULL, body TEXT NOT NULL, UNIQUE(author,dedupe_key))')
            db.execute('CREATE TABLE IF NOT EXISTS calls (actor TEXT, request_id TEXT, payload_sha TEXT, '
                       'result TEXT, PRIMARY KEY(actor,request_id))')
            db.execute('CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, '
                       'case_id TEXT, actor TEXT, at REAL, body TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS cycles (actor TEXT PRIMARY KEY, fingerprint TEXT, '
                       'status TEXT, at REAL, result TEXT)')
            yield db
            db.commit()
        except BaseException:
            db.rollback(); raise
        finally:
            db.close()

    def _previous(self, db, request_id, payload):
        if not isinstance(request_id, str) or not KEY.fullmatch(request_id):
            raise ValueError('invalid_request_id')
        row = db.execute('SELECT * FROM calls WHERE actor=? AND request_id=?', (self.actor, request_id)).fetchone()
        if row:
            if row['payload_sha'] != digest(payload): raise ValueError('request_conflict')
            return json.loads(row['result'])

    def _record(self, db, request_id, payload, result):
        db.execute('INSERT INTO calls VALUES (?,?,?,?)', (self.actor, request_id, digest(payload), encode(result)))
        return result

    @staticmethod
    def _case(row):
        return json.loads(row['body']) | {key: row[key] for key in
            ('id', 'author', 'owner', 'status', 'version', 'updated_at')}

    def roster(self):
        inventory = members()
        hosts = native_inventory(inventory)
        return {'ok': True, 'members': [{'actor': actor, 'name': value[0], 'responsibility': value[1],
                                        'nativeHost': hosts[actor]}
            for actor, value in inventory.items()],
            'notice': 'Actor is the durable logical author; nativeHost identifies its current Qwen console. '
                      'These are project handoffs; in-world dialogue still uses actual game channels.'}

    def cases(self, owner='mine', include_closed=False, limit=12):
        if type(limit) is not int or not 1 <= limit <= 30: raise ValueError('invalid_limit')
        selected = self.actor if owner == 'mine' else owner
        if selected != 'all' and selected not in members(): raise ValueError('invalid_owner')
        with self.db() as db:
            query, args = 'SELECT * FROM cases WHERE 1=1', []
            if selected != 'all': query += ' AND owner=?'; args.append(selected)
            if not include_closed: query += " AND status NOT IN ('resolved','duplicate')"
            query += ' ORDER BY updated_at DESC,id LIMIT ?'; args.append(limit)
            rows = [self._case(row) for row in db.execute(query, args)]
        return {'ok': True, 'cases': [{k: row[k] for k in
            ('id', 'title', 'category', 'author', 'owner', 'status', 'version', 'updated_at', 'document')} for row in rows],
            'notice': 'Case status is attributed team reporting. Read receipts before declaring a fix live.'}

    def case(self, case_id):
        with self.db() as db:
            row = db.execute('SELECT * FROM cases WHERE id=?', (case_id,)).fetchone()
            if not row: return {'ok': False, 'code': 'case_not_found'}
            events = [{'actor': r['actor'], 'at': r['at'], **json.loads(r['body'])}
                      for r in db.execute('SELECT * FROM events WHERE case_id=? ORDER BY seq DESC LIMIT 20', (case_id,))]
        return {'ok': True, 'case': self._case(row), 'events': list(reversed(events))}

    def report(self, request_id, dedupe_key, title, category, observed, expected, evidence):
        if not isinstance(dedupe_key, str) or not KEY.fullmatch(dedupe_key): raise ValueError('invalid_dedupe_key')
        if category not in ('bug', 'gameplay', 'content', 'operations', 'improvement'): raise ValueError('invalid_category')
        payload = dict(dedupe_key=dedupe_key, title=text(title, 160, 'title'), category=category,
                       observed=text(observed, 6000, 'observed'), expected=text(expected, 2000, 'expected'),
                       evidence=self._evidence(evidence))
        with self.db() as db:
            previous = self._previous(db, request_id, payload)
            if previous: return previous
            existing = db.execute('SELECT * FROM cases WHERE author=? AND dedupe_key=?',
                                  (self.actor, dedupe_key)).fetchone()
            if existing:
                # Keep a stable case and attach fresh observations, including after closure.
                case_id = existing['id']
                status = 'open' if existing['status'] in ('resolved', 'duplicate') else existing['status']
                db.execute('UPDATE cases SET status=?,version=version+1,updated_at=? WHERE id=?',
                           (status, self.clock(), case_id))
            else:
                case_id = 'case-' + digest([self.actor, dedupe_key])[:20]
                document_name = 'feedback/' + self.actor.replace(':', '__') + '/' + case_id + '.md'
                db.execute('INSERT INTO cases VALUES (?,?,?,?,?,?,?,?)',
                    (case_id, self.actor, dedupe_key, 'game:mc-god', 'open', 1, self.clock(), encode(payload | {'document': document_name})))
                document = self.root / document_name
                document.parent.mkdir(parents=True, exist_ok=True)
                if document.is_symlink() or document.parent.is_symlink(): raise ValueError('linked_feedback')
                body = f'# {payload["title"]}\n\n作者：{self.actor}（{members()[self.actor][0]}）\n工单：{case_id}\n\n'
                body += '## 实际观察\n\n' + payload['observed'] + '\n\n## 预期与建议\n\n' + payload['expected']
                body += '\n\n## 来源\n\n' + '\n'.join('- ' + e for e in payload['evidence']) + '\n'
                document.write_text(body, encoding='utf-8')
            db.execute('INSERT INTO events(case_id,actor,at,body) VALUES (?,?,?,?)',
                       (case_id, self.actor, self.clock(), encode({'type': 'feedback', **payload})))
            result = {'ok': True, 'code': 'feedback_recorded', 'caseId': case_id,
                      'document': self._case(db.execute('SELECT * FROM cases WHERE id=?', (case_id,)).fetchone())['document']}
            return self._record(db, request_id, payload, result)

    @staticmethod
    def _evidence(values):
        if not isinstance(values, list) or not 1 <= len(values) <= 8:
            raise ValueError('evidence_required')
        return [text(value, 1200, 'evidence') for value in values]

    def update(self, request_id, case_id, expected_version, status, note, evidence, assign_to=None):
        if status not in STATUSES or type(expected_version) is not int: raise ValueError('invalid_case_update')
        if assign_to is not None and assign_to not in members(): raise ValueError('invalid_assignee')
        payload = dict(case_id=case_id, expected_version=expected_version, status=status,
                       note=text(note, 6000, 'note'), evidence=self._evidence(evidence), assign_to=assign_to)
        with self.db() as db:
            previous = self._previous(db, request_id, payload)
            if previous: return previous
            row = db.execute('SELECT * FROM cases WHERE id=?', (case_id,)).fetchone()
            if not row: return {'ok': False, 'code': 'case_not_found'}
            if row['version'] != expected_version:
                return {'ok': False, 'code': 'case_changed', 'version': row['version']}
            coordinator = self.actor in COORDINATORS
            if self.actor != row['owner'] and not coordinator: raise ValueError('case_owner_required')
            if assign_to is not None and not coordinator: raise ValueError('coordinator_assigns_work')
            if status in ('resolved', 'duplicate') and not coordinator:
                raise ValueError('independent_review_required')
            owner = assign_to or row['owner']
            db.execute('UPDATE cases SET owner=?,status=?,version=version+1,updated_at=? WHERE id=?',
                       (owner, status, self.clock(), case_id))
            db.execute('INSERT INTO events(case_id,actor,at,body) VALUES (?,?,?,?)',
                       (case_id, self.actor, self.clock(), encode({'type': 'update', **payload})))
            return self._record(db, request_id, payload, {'ok': True, 'code': 'case_updated',
                'caseId': case_id, 'version': expected_version + 1, 'owner': owner, 'status': status})

    def work_fingerprint(self):
        with self.db() as db:
            rows = [dict(row) for row in db.execute(
                "SELECT id,version,status FROM cases WHERE owner=? AND status NOT IN ('resolved','duplicate') ORDER BY id",
                (self.actor,))]
        return digest(rows), bool(rows)

    def cycle_state(self):
        with self.db() as db:
            row = db.execute('SELECT * FROM cycles WHERE actor=?', (self.actor,)).fetchone()
        return dict(row) if row else None

    def save_cycle(self, fingerprint, status, result=None):
        with self.db() as db:
            db.execute('INSERT OR REPLACE INTO cycles VALUES (?,?,?,?,?)',
                       (self.actor, fingerprint, status, self.clock(), encode(result or {})))
