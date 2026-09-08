"""Content proposals and append-only publication through the existing NPC guild.

Qwen chooses the story and objectives. This module only validates supported
contracts, records approval, and appends them under the guild's economy lock.
It never runs a model, server command, reward transfer, or background worker.
"""
from copy import deepcopy
from datetime import date, timedelta
import hashlib
import json
from pathlib import Path
import re
import time
import unicodedata

from npc_identity import binding, contract_issuer, valid_position
from npc_planner import QUEST_ITEMS
from qwen_tasks import read_json, write_json, state_lock
from guild_rules import gather_matches, is_far_horizon

ACTORS = ('game:qd-guild-planner', 'game:mc-god', 'operations:mc-priest')
ID = re.compile(r'[A-Za-z0-9_-]{1,80}\Z')
CONTENT_ID = re.compile(r'content-[a-f0-9]{24}\Z')
MOBS = {'skeleton': '骷髅', 'zombie': '僵尸', 'spider': '蜘蛛'}
BLOCKED = {
    'boss': {'ready': False, 'code': 'boss_adapter_missing',
             'missing': ['勘察并确认场地', '原生生成前后UUID回执', '绑定本次首领的击杀证明', '清理与未知状态恢复'],
             'repairOwner': 'game:mc-god'},
    'chest': {'ready': False, 'code': 'chest_adapter_missing',
              'missing': ['勘察并确认场地', '方块与物品放置前后回执', '本次宝箱战利品归属证明', '未知状态恢复'],
              'repairOwner': 'game:mc-god'},
}


def require(test, code):
    if not test:
        raise ValueError(code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     allow_nan=False, separators=(',', ':')).encode('utf8')).hexdigest()


def text(value, limit):
    require(isinstance(value, str) and 1 <= len(value.strip()) <= limit
            and not any(unicodedata.category(c) in ('Cc', 'Cf', 'Cs') for c in value), 'invalid_content_text')
    return value.strip()


def safe(path):
    path = Path(path)
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'linked_content_path')
    return path


def load(path):
    return read_json(safe(path))


def save(path, value):
    write_json(safe(path), value)


def objective(row):
    """Exclude mutable progress while preserving actual contract identity."""
    fields = ('no', 'type', 'qid', 'rank', 'party', 'from', 'item', 'mob', 'count',
              'reward', 'fame', 'spot', 'pos', 'r', 'contentId', 'contentStageId')
    return {k: row[k] for k in fields if k in row}


def make_context(npc, guild, *, today=None, clock=time.time):
    current = today or date.today()
    receptionist = next((p for p in npc.PROFILES if contract_issuer(p, 'reception')), None)
    try:
        reception_ready = receptionist is not None and valid_position(npc.alive_pos(receptionist))
    except Exception:
        reception_ready = False
    issuers = []
    for person in npc.PROFILES:
        kinds = [kind for kind in ('gather', 'hunt', 'visit') if contract_issuer(person, kind)]
        if not kinds:
            continue
        try:
            position = npc.alive_pos(person)
        except Exception:
            position = None
        if valid_position(position):
            issuers.append({'key': person['key'], 'display': person['display'],
                            'uuid': binding(person)['uuid'], 'profession': person['profession'],
                            'kinds': kinds, 'position': list(position)})
    days = {}
    for day in (current, current + timedelta(days=1)):
        name = day.isoformat()
        board_path = Path(guild.guild_path(name))
        board = load(board_path) if board_path.exists() else {'date': name, 'board': []}
        quest_path = Path(npc.quests_path(name))
        quests = load(quest_path) if quest_path.exists() else {'date': name, 'quests': []}
        days[name] = {'contracts': [
            {'questId': name + ':' + str(b['no']), 'title': b['title'], 'type': b['type'],
             'issuer': b.get('from'), 'status': b['status'], 'objective': objective(b),
             'objectiveSha256': digest(objective(b))}
            for b in board['board'] if b['type'] in ('gather', 'hunt', 'visit') and not b.get('party')
            and (b['type'] != 'gather' or gather_matches(b, quests['quests']))
            and (b['type'] != 'visit' or is_far_horizon(b))],
            'busyGatherIssuers': sorted({q['villager'] for q in quests['quests'] if not q.get('done')})}
    return {'schema': 1, 'updatedAt': clock(), 'today': current.isoformat(), 'days': days,
            'receptionReady': reception_ready,
            'issuers': issuers, 'items': QUEST_ITEMS, 'mobs': MOBS,
            'proposalFormat': {'fields': ['date', 'title', 'story', 'ending', 'stages'],
                'stages': {'common': ['id', 'kind', 'title', 'pitch'],
                    'gather': ['issuer', 'item', 'count', 'reward'],
                    'hunt': ['issuer', 'mob', 'count', 'reward'],
                    'visit': ['issuer', 'destination', 'reward'], 'existing': ['questId']},
                'limits': {'stages': '1..6', 'gatherCount': '3..24', 'huntCount': '1..5',
                           'rewardEmeralds': '1..3', 'titleChars': 80, 'stageTitleChars': 60,
                           'storyChars': 800, 'endingChars': 240, 'pitchChars': 80},
                'note': 'stage顺序是剧情建议，原公会仍逐单接取/验收；不另加剧情通关奖励。'},
            'destinations': {'far_horizon': {'kind': 'distance_from_guild_anchor',
                'origin': list(guild.PLAZA), 'minimumDistance': 300,
                'description': '从公会既定锚点外出300格，复用实际位置验收；不代表某处遗迹已经生成。'}},
            'capabilities': {**{k: {'ready': True} for k in ('story', 'gather', 'hunt', 'visit', 'existing')},
                             **deepcopy(BLOCKED)}}


def validate_episode(payload, context):
    require(isinstance(payload, dict) and set(payload) == {'date', 'title', 'story', 'ending', 'stages'}, 'invalid_content_schema')
    require(isinstance(payload['date'], str) and payload['date'] in context['days'], 'invalid_content_day')
    require(context.get('receptionReady') is True, 'content_reception_unavailable')
    result = {k: text(payload[k], limit) for k, limit in (('title', 80), ('story', 800), ('ending', 240))}
    result['date'] = payload['date']
    rows = payload['stages']
    require(isinstance(rows, list) and 1 <= len(rows) <= 6, 'invalid_content_stages')
    day = context['days'][payload['date']]
    people = {p['key']: p for p in context['issuers']}
    refs = {q['questId']: q for q in day['contracts']}
    busy = set(day['busyGatherIssuers'])
    stage_ids, referenced, selected = set(), set(), []
    common = {'id', 'kind', 'title', 'pitch'}
    fields = {'existing': {'questId'}, 'gather': {'issuer', 'item', 'count', 'reward'},
              'hunt': {'issuer', 'mob', 'count', 'reward'}, 'visit': {'issuer', 'destination', 'reward'}}
    for row in rows:
        require(isinstance(row, dict), 'invalid_content_stage')
        kind = row.get('kind')
        require(isinstance(kind, str), 'invalid_content_kind')
        require(kind not in BLOCKED, BLOCKED.get(kind, {}).get('code', 'unsupported_content_kind'))
        require(kind in fields and set(row) == common | fields[kind], 'invalid_content_stage')
        require(isinstance(row['id'], str) and ID.fullmatch(row['id']) and row['id'] not in stage_ids, 'invalid_content_stage_id')
        stage_ids.add(row['id'])
        item = {**row, 'title': text(row['title'], 60), 'pitch': text(row['pitch'], 80)}
        if kind == 'existing':
            require(isinstance(row['questId'], str), 'invalid_content_reference')
            ref = refs.get(row['questId'])
            require(ref is not None and ref['status'] == 'open' and row['questId'] not in referenced, 'content_contract_unavailable')
            person = people.get(ref['issuer'])
            require(person is not None and ref['type'] in person['kinds'], 'content_issuer_unavailable')
            item.update(issuer=ref['issuer'], issuerUuid=person['uuid'], objectiveSha256=ref['objectiveSha256'])
            referenced.add(row['questId'])
        else:
            require(isinstance(row['issuer'], str), 'invalid_content_issuer')
            person = people.get(row['issuer'])
            require(person is not None and kind in person['kinds'], 'content_issuer_unavailable')
            require(type(row['reward']) is int and 1 <= row['reward'] <= 3, 'invalid_content_reward')
            item['issuerUuid'] = person['uuid']
            if kind in ('gather', 'hunt'):
                require(type(row['count']) is int and (3 <= row['count'] <= 24 if kind == 'gather' else 1 <= row['count'] <= 5), 'invalid_content_quantity')
            if kind == 'gather':
                require(isinstance(row['item'], str), 'invalid_content_item')
                require(row['item'] in QUEST_ITEMS, 'invalid_content_item')
                require(row['issuer'] not in busy, 'content_issuer_has_open_gather')
                busy.add(row['issuer'])
            elif kind == 'hunt':
                require(isinstance(row['mob'], str), 'invalid_content_mob')
                require(row['mob'] in MOBS, 'invalid_content_mob')
            else:
                require(row['destination'] == 'far_horizon' and row['destination'] in context['destinations'], 'content_destination_unverified')
        selected.append(item)
    result['stages'] = selected
    return result


class ContentQueue:
    def __init__(self, state=Path('/team'), *, clock=time.time):
        self.root, self.clock = safe(Path(state) / 'content'), clock

    def context(self):
        try:
            value = load(self.root / 'context.json')
            require(value['schema'] == 1 and -5 <= self.clock() - value['updatedAt'] <= 120, 'stale_content_context')
            # Give the next native role turn a discoverable, compact handoff;
            # knowing an opaque content ID must not require a side-channel chat.
            proposals = []
            files = sorted((self.root / 'proposals').glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)
            for path in files[:256]:
                require(CONTENT_ID.fullmatch(path.stem), 'invalid_content_index_id')
                row = load(path)
                receipt = self.root / 'receipts' / path.name
                publication = load(receipt) if receipt.exists() else {}
                approved = (self.root / 'publish' / path.name).exists()
                proposals.append({'contentId': row['contentId'], 'actor': row['actor'],
                    'title': row['content']['title'], 'date': row['content'].get('date'),
                    'submittedAt': row['submittedAt'],
                    'status': publication.get('status') or ('approved_pending' if approved else row['status'])})
            return {'ok': True, **value, 'proposals': proposals[:30],
                    'proposalsTruncated': len(files) > 30}
        except (OSError, ValueError, KeyError, TypeError):
            return {'ok': False, 'code': 'content_context_unavailable', 'capabilities': deepcopy(BLOCKED)}

    def _id(self, actor, request_id):
        require(actor in ACTORS and isinstance(request_id, str) and ID.fullmatch(request_id), 'invalid_content_actor_or_request')
        return 'content-' + digest([actor, request_id])[:24]

    def read(self, actor, content_id):
        require(actor in ACTORS and isinstance(content_id, str) and CONTENT_ID.fullmatch(content_id), 'invalid_content_actor_or_id')
        path = self.root / 'proposals' / (content_id + '.json')
        if not path.exists():
            return {'ok': False, 'code': 'content_not_found'}
        row = load(path)
        publication = self.root / 'receipts' / (content_id + '.json')
        return {'ok': True, **row, 'publication': load(publication) if publication.exists() else None}

    def submit(self, actor, request_id, payload):
        require(actor == 'game:qd-guild-planner', 'content_designer_required')
        content_id = self._id(actor, request_id)
        path = self.root / 'proposals' / (content_id + '.json')
        with state_lock(self.root):
            if path.exists():
                old = load(path)
                require(old['payloadSha256'] == digest(payload), 'content_request_conflict')
                return {'ok': True, 'code': 'already_submitted', 'contentId': content_id}
            context = self.context()
            require(context.get('ok'), 'content_context_unavailable')
            content = validate_episode(payload, context)
            row = {'schema': 1, 'contentId': content_id, 'actor': actor, 'requestId': request_id,
                   'payloadSha256': digest(payload), 'contextSha256': digest(context), 'submittedAt': self.clock(),
                   'status': 'proposed', 'content': content, 'worldActionsExecuted': 0}
            save(path, row)
        return {'ok': True, 'code': 'content_submitted', 'contentId': content_id, 'worldActionsExecuted': 0}

    def story(self, actor, request_id, title, story, objectives):
        require(actor == 'operations:mc-priest', 'content_story_author_required')
        content_id = self._id(actor, request_id)
        require(isinstance(objectives, list) and 1 <= len(objectives) <= 6, 'invalid_content_objectives')
        content = {'title': text(title, 80), 'story': text(story, 800), 'objectives': [text(v, 120) for v in objectives]}
        path = self.root / 'proposals' / (content_id + '.json')
        with state_lock(self.root):
            if path.exists():
                require(load(path)['payloadSha256'] == digest(content), 'content_request_conflict')
            else:
                save(path, {'schema': 1, 'contentId': content_id, 'actor': actor, 'requestId': request_id,
                            'status': 'story_proposed', 'submittedAt': self.clock(), 'content': content,
                            'payloadSha256': digest(content), 'worldActionsExecuted': 0})
        return {'ok': True, 'code': 'story_proposed', 'contentId': content_id, 'worldActionsExecuted': 0}

    def publish(self, actor, request_id, content_id):
        require(actor == 'game:mc-god', 'content_administrator_required')
        self._id(actor, request_id)
        with state_lock(self.root):
            proposal = self.read(actor, content_id)
            require(proposal.get('ok') and proposal['actor'] == 'game:qd-guild-planner', 'executable_content_required')
            request = {'schema': 1, 'contentId': content_id, 'actor': actor, 'requestId': request_id,
                       'proposalSha256': proposal['payloadSha256'], 'requestedAt': self.clock()}
            path = self.root / 'publish' / (content_id + '.json')
            if path.exists():
                old = load(path)
                require(all(old[k] == request[k] for k in ('actor', 'requestId', 'proposalSha256')), 'content_publish_conflict')
            else:
                save(path, request)
        return {'ok': True, 'code': 'publication_requested', 'contentId': content_id, 'worldActionsExecuted': 0}


def _contract_rows(content_id, content, context, guild, first_no):
    people = {p['key']: p for p in context['issuers']}
    board, quests, references = [], [], []
    for stage in content['stages']:
        if stage['kind'] == 'existing':
            references.append(stage['questId'])
            continue
        kind = stage['kind']
        person = people[stage['issuer']]
        row = {'no': first_no + len(board), 'type': kind, 'rank': 0, 'from': stage['issuer'],
               'display': person['display'], 'title': stage['title'], 'pitch': stage['pitch'],
               'reward': stage['reward'], 'fame': 3 if kind == 'visit' else 1,
               'status': 'open', 'taker': [], 'taken_at': None, 'done_by': None, 'done_at': None,
               'contentId': content_id, 'contentStageId': stage['id']}
        if kind == 'gather':
            qid = content_id + '-' + stage['id']
            row.update(qid=qid, item=stage['item'], zh=QUEST_ITEMS[stage['item']], count=stage['count'])
            quests.append({'id': qid, 'villager': stage['issuer'], 'display': person['display'],
                           'item': stage['item'], 'zh': row['zh'], 'count': stage['count'],
                           'emerald': stage['reward'], 'pitch': stage['pitch'], 'effect': None, 'lore_atom': False,
                           'done': False, 'done_by': None, 'done_at': None,
                           'source': 'qwenpaw-content', 'contentId': content_id, 'contentStageId': stage['id']})
        elif kind == 'hunt':
            row.update(mob=stage['mob'], zh=MOBS[stage['mob']], count=stage['count'], baseline={})
        else:
            row.update(spot='far_horizon', zh='远方的地平线', r=0,
                       pos=[guild.PLAZA[0] + 320, guild.PLAZA[1], guild.PLAZA[2]])
        board.append(row)
    require(all(1 <= row['no'] <= 99 for row in board), 'guild_board_capacity')
    return board, quests, references


def _append(path, day, key, rows, identity, immutable):
    """Recover by stable IDs; preserve all earlier progress, even after a crash."""
    doc = load(path) if path.exists() else {'date': day, key: []}
    require(doc.get('date') == day and isinstance(doc.get(key), list), 'content_publication_document_invalid')
    for row in rows:
        found = [old for old in doc[key] if old.get(identity) == row[identity]]
        require(len(found) <= 1, 'content_publication_identity_collision')
        if found:
            require(immutable(found[0]) == immutable(row), 'content_publication_identity_collision')
        else:
            doc[key].append(deepcopy(row))
    save(path, doc)
    return doc


def _quest_identity(row):
    return {k: row.get(k) for k in ('id', 'villager', 'item', 'count', 'emerald', 'contentId', 'contentStageId')}


def _publish_one(queue, npc, guild, request, current, clock):
    content_id = request['contentId']
    proposal = queue.read('game:mc-god', content_id)
    require(request['actor'] == 'game:mc-god' and request['schema'] == 1
            and proposal.get('ok') and proposal['actor'] == 'game:qd-guild-planner'
            and proposal['payloadSha256'] == request['proposalSha256'], 'content_publication_request_invalid')
    content = proposal['content']
    receipt_path = queue.root / 'receipts' / (content_id + '.json')
    receipt = load(receipt_path) if receipt_path.exists() else None
    if receipt and receipt['status'] in ('published', 'blocked', 'expired'):
        return receipt
    day = date.fromisoformat(content['date'])
    if day > current:
        return {'contentId': content_id, 'status': 'scheduled', 'date': content['date']}
    if day < current:
        receipt = {'contentId': content_id, 'status': 'expired', 'date': content['date'], 'updatedAt': clock()}
        save(receipt_path, receipt)
        return receipt
    with guild.state_lock():
        # Initialize today's normal publication first, then append without its
        # random template chance; no authored valid stage is randomly dropped.
        guild.board_today()
        npc.quests_today()
        board_path, quest_path = Path(guild.guild_path(content['date'])), Path(npc.quests_path(content['date']))
        if not receipt:
            context = make_context(npc, guild, today=current, clock=clock)
            payload = {k: content[k] for k in ('date', 'title', 'story', 'ending')}
            payload['stages'] = [{k: v for k, v in stage.items() if k not in ('issuerUuid', 'objectiveSha256')
                                  and not (stage['kind'] == 'existing' and k == 'issuer')}
                                 for stage in content['stages']]
            try:
                checked = validate_episode(payload, context)
                require(checked == content, 'content_context_changed')
                board_before, quests_before = load(board_path), load(quest_path)
                no = max((b['no'] for b in board_before['board']), default=0) + 1
                board_rows, quest_rows, refs = _contract_rows(content_id, content, context, guild, no)
            except ValueError as exc:
                receipt = {'contentId': content_id, 'status': 'blocked', 'code': str(exc), 'updatedAt': clock()}
                save(receipt_path, receipt)
                return receipt
            receipt = {'schema': 1, 'contentId': content_id, 'status': 'publishing', 'date': content['date'],
                       'proposalSha256': request['proposalSha256'], 'startedAt': clock(), 'worldActionsExecuted': 0,
                       'before': {'boardSha256': digest(board_before), 'questsSha256': digest(quests_before)},
                       'boardRows': board_rows, 'questRows': quest_rows, 'references': refs}
            save(receipt_path, receipt)
        # After a crash the recorded rows are the only permitted write plan.
        # Resolve every bound issuer again before adding anything still absent.
        require(receipt.get('proposalSha256') == proposal['payloadSha256'], 'content_receipt_conflict')
        people = {p['key']: p for p in npc.PROFILES}
        for stage in content['stages']:
            person = people.get(stage['issuer'])
            require(person is not None and binding(person)['uuid'] == stage['issuerUuid'], 'content_issuer_binding_changed')
        quests_after = _append(quest_path, content['date'], 'quests', receipt['questRows'], 'id', _quest_identity)
        board_rows = deepcopy(receipt['boardRows'])
        completed_goods = {q['id']: q for q in quests_after['quests'] if q.get('done') is True}
        for row in board_rows:
            # A native merchant may have settled an appended goods contract
            # before recovery publishes its board row. Do not reopen it or
            # invent another reward/fame transfer during recovery.
            if row.get('qid') in completed_goods:
                quest = completed_goods[row['qid']]
                row.update(status='done', done_by=quest.get('done_by'), done_at=quest.get('done_at'))
        board_after = _append(board_path, content['date'], 'board', board_rows, 'no', objective)
        guild.BOARD.update(date=content['date'], doc=board_after)
        if hasattr(npc, 'QUESTS'):
            npc.QUESTS.update(date=content['date'], doc=quests_after)
        # The independently readable episode links real contract IDs; this is
        # publication evidence, not a statement that players completed it.
        stage_ids = {b['contentStageId']: content['date'] + ':' + str(b['no']) for b in receipt['boardRows']}
        episode = {'schema': 1, 'contentId': content_id, **content,
                   'questIds': [s['questId'] if s['kind'] == 'existing' else stage_ids[s['id']] for s in content['stages']],
                   'publishedAt': clock(), 'completion': 'not_verified'}
        save(queue.root / 'published' / (content_id + '.json'), episode)
        _append(queue.root / 'published-days' / (content['date'] + '.json'), content['date'],
                'episodes', [{'contentId': content_id}], 'contentId', lambda row: row)
        receipt.update(status='published', publishedAt=clock(),
                       after={'boardSha256': digest(load(board_path)), 'questsSha256': digest(load(quest_path))},
                       newContracts=len(receipt['boardRows']), referencedContracts=len(receipt['references']),
                       questIds=episode['questIds'])
        save(receipt_path, receipt)
        return receipt


def episode_lines(board, *, state=Path('/team'), quest_no=None):
    """Read-only player text; only confirmed publications matching this board."""
    try:
        root = safe(Path(state) / 'content')
        day = date.fromisoformat(board['date']).isoformat()
        index = root / 'published-days' / (day + '.json')
        if not index.exists():
            return []
        entries = load(index)
        require(entries.get('date') == day, 'content_day_mismatch')
        by_no = {row['no']: row for row in board['board']}
        episodes = []
        for record in entries['episodes']:
            content_id = record['contentId']
            require(isinstance(content_id, str) and CONTENT_ID.fullmatch(content_id), 'invalid_content_id')
            receipt = load(root / 'receipts' / (content_id + '.json'))
            if receipt.get('status') != 'published':
                continue
            episode = load(root / 'published' / (content_id + '.json'))
            require(episode.get('date') == day and receipt.get('date') == day
                    and episode.get('contentId') == receipt.get('contentId') == content_id
                    and episode.get('questIds') == receipt.get('questIds'), 'content_display_receipt_mismatch')
            nums = [int(q.partition(':')[2]) for q in episode['questIds'] if q.partition(':')[0] == day]
            require(len(nums) == len(episode['stages']), 'content_display_contract_mismatch')
            if quest_no is not None and quest_no not in nums:
                continue
            expected = {row['no']: row for row in receipt['boardRows']}
            for stage, no in zip(episode['stages'], nums):
                require(no in by_no, 'content_display_contract_missing')
                if stage['kind'] == 'existing':
                    require(digest(objective(by_no[no])) == stage['objectiveSha256'], 'content_display_contract_changed')
                else:
                    require(no in expected and objective(by_no[no]) == objective(expected[no]), 'content_display_contract_changed')
            episodes.append((episode, nums))
        lines = []
        for episode, nums in (episodes[:3] if quest_no is None else episodes):
            lines.append('【故事活动 · ' + text(episode['title'], 80) + '】')
            story = text(episode['story'], 800)
            if quest_no is None:
                lines.append(story[:140] + ('…' if len(story) > 140 else ''))
                lines.append('路线：' + ' → '.join('No.' + str(n) for n in nums)
                             + '；对岚说「活动 ' + str(nums[0]) + '」查看正文。')
            else:
                lines.extend(story[n:n+160] for n in range(0, len(story), 160))
                for index_no, (stage, no) in enumerate(zip(episode['stages'], nums), 1):
                    lines.append('第%d步「%s」：%s（No.%d，当前%s）' % (
                        index_no, text(stage['title'], 60), text(stage['pitch'], 80), no,
                        {'open':'可接', 'claimed':'有人承接', 'done':'该合同已结算'}.get(by_no[no]['status'], '状态待核对')))
                lines.append('预设结局（剧情文本，不是通关回执）：' + text(episode['ending'], 240))
                lines.append('路线顺序供参考；逐单接取，实际完成与奖励只看原公会记录。')
        if quest_no is None and len(episodes) > 3:
            lines.append('另有%d项已发布故事活动；可用「活动 编号」查看相关单的剧情。' % (len(episodes)-3))
        return lines
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        # Ordinary contracts remain readable when an optional narrative file
        # is unavailable; do not invent its contents or modify its receipt.
        return []


def tick(npc, guild, *, state=Path('/team'), today=None, clock=time.time):
    """One call from the existing supervised NPC worker, never a new loop."""
    queue = ContentQueue(state, clock=clock)
    current = today or date.today()
    results = []
    with state_lock(queue.root):
        for path in sorted((queue.root / 'publish').glob('*.json')):
            try:
                request = load(path)
                require(CONTENT_ID.fullmatch(path.stem) and request.get('contentId') == path.stem, 'invalid_content_request_file')
                results.append(_publish_one(queue, npc, guild, request, current, clock))
            except (OSError, ValueError, TypeError, KeyError) as exc:
                results.append({'contentId': path.stem, 'status': 'publication_unconfirmed', 'errorType': type(exc).__name__})
        context = make_context(npc, guild, today=current, clock=clock)
        save(queue.root / 'context.json', context)
        public = {'schema': 1, 'updatedAt': clock(), 'publications': [{k: r.get(k) for k in
            ('contentId', 'status', 'code', 'date', 'newContracts', 'referencedContracts', 'questIds', 'publishedAt') if k in r}
            for r in results], 'capabilities': context['capabilities']}
        save(queue.root / 'status.json', public)
        return public
