"""Normal-player guild requests over a local durable mailbox.

The existing NPC process remains the only guild owner. Requests use its board,
daily goods, rank and fame. A persisted settlement barrier precedes inventory
changes; an interrupted clear/give is never retried or compensated blindly.
"""
from datetime import date
from pathlib import Path
import hashlib
import json
import math
import os
import re
import time
import uuid
import guild_inventory as inventory

ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z')
ACTOR = re.compile(r'[A-Za-z0-9_]{1,16}\Z')
QUEST = re.compile(r'(\d{4}-\d{2}-\d{2}):([1-9]\d?)\Z')
ITEM = re.compile(r'[a-z0-9_]{1,64}\Z')
_LAST_POLL = 0.0
_NPC_HEALTH = {}


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x', encoding='utf8') as stream:
            json.dump(value, stream, ensure_ascii=False, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read(path):
    path = Path(path)
    if path.is_symlink() or path.stat().st_size > 262144:
        raise ValueError('invalid_guild_file')
    result = json.loads(path.read_text(encoding='utf-8-sig'))
    if not isinstance(result, dict):
        raise ValueError('invalid_guild_file')
    return result


def reply(code, summary, ok=False, **fields):
    return {'ok': ok, 'code': code, 'summary': summary, **fields}


def valid_position(value):
    return isinstance(value, (list, tuple)) and len(value) == 3 and all(type(x) in (int, float) and math.isfinite(x) for x in value)


def near_npc(npc, actor, profile, limit):
    """Configured NPC selectors resolve in overworld; require the same realm."""
    try:
        if not profile or not ACTOR.fullmatch(actor):
            return False
        dimension = npc.R.cmd('data get entity %s Dimension' % actor)
        if not re.search(r':\s*"minecraft:overworld"\s*$', dimension or ''):
            return False
        player, target = npc.player_pos(actor), npc.alive_pos(profile)
        return (valid_position(player) and valid_position(target)
                and math.dist(player, target) <= min(12, max(1, float(limit))))
    except Exception:
        return False


def transaction_path(npc, day, qid):
    key = hashlib.sha256((day + '\0' + qid).encode()).hexdigest()
    return Path(npc.VDIR) / 'guild-transactions' / (key + '.json')


def deliver_quest(npc, guild, actor, profile, quest, request_id=None, actor_uuid=None):
    """Shared by the structured CLI and old NPC turn_in, with one quest barrier."""
    with guild.state_lock():
        day = time.strftime('%Y-%m-%d')
        qid = quest.get('id')
        if not ACTOR.fullmatch(actor or '') or not isinstance(qid, str) or not 1 <= len(qid) <= 160:
            return reply('invalid_delivery', '交付请求无效。')
        path = transaction_path(npc, day, qid)
        if path.exists():
            previous = read(path)
            if previous.get('phase') == 'completed':
                return reply('already_completed', '这笔货单已结算，不会重复扣货或发奖。', receipt=previous)
            return reply('outcome_unknown', '这笔货单已有未核对的交割记录，不能重新扣货或发奖。', receipt=previous)
        if not near_npc(npc, actor, profile, npc.CFG.get('trade_proximity', 5)):
            return reply('npc_not_near', '请与发单人处于同一维度并走到柜台前；位置未知时不能交货。')
        # Reconcile any already-completed native GUI trade before taking goods.
        for person in npc.PROFILES:
            if person.get('key') == profile.get('key') or person.get('market_agg'):
                npc._scan_settle(person)
        doc = npc.quests_today()
        q = next((row for row in doc['quests'] if row.get('id') == qid), None)
        if not q or q.get('done') or any(q.get(key) != quest.get(key) for key in ('villager', 'item', 'count', 'emerald')):
            return reply('quest_changed', '货单已经变化或结清，请重新查看看板。')
        board = guild.board_today()
        task = next((b for b in board['board'] if b.get('type') == 'gather' and b.get('qid') == qid), None)
        if task and task.get('status') == 'claimed' and guild._takers(task) != [actor]:
            return reply('claimed_by_other', '这笔委托已由其他冒险者承接。')
        if task and (task.get('status') == 'done' or not guild._gather_matches(task)):
            return reply('quest_changed', '看板与柜台实际货单不一致。')
        item, count, reward = q.get('item'), q.get('count'), q.get('emerald', 0)
        if (not isinstance(item, str) or not ITEM.fullmatch(item) or type(count) is not int or not 1 <= count <= 64
                or type(reward) is not int or not 0 <= reward <= 64
                or (q.get('effect') and (not isinstance(q['effect'], str) or not ITEM.fullmatch(q['effect'])))
                or (task and (type(task.get('fame', 1)) is not int or not 0 <= task.get('fame', 1) <= 16))):
            return reply('unsupported_contract', '这笔货单超出已验证的交付规格。')
        try:
            available = inventory.count_item(npc, actor, 'minecraft:' + item)
            capacity = inventory.snapshot(npc, actor)
            if actor_uuid is not None and capacity['actorUuid'] != actor_uuid:
                return reply('actor_mismatch', '在线角色身份已变化，尚未扣货。')
            emerald_before = inventory.count_item(npc, actor, 'minecraft:emerald')
        except (OSError, ValueError, KeyError, TypeError):
            return reply('inventory_unavailable', '未能确认实际背包材料，尚未扣货。')
        if available < count:
            return reply('missing_goods', '实际材料不足，尚未扣货。', required=count, available=available)
        if capacity['emeraldCapacity'] < reward:
            return reply('inventory_full', '背包没有足够位置接收绿宝石，请先整理背包；尚未扣货。', requiredCapacity=reward,
                         availableCapacity=capacity['emeraldCapacity'])
        record = {'schema': 1, 'requestId': request_id or str(uuid.uuid4()), 'actor': actor,
                  'actorUuid': capacity['actorUuid'], 'goodsBefore': available, 'emeraldBefore': emerald_before,
                  'boardDate': day, 'questId': qid, 'itemId': 'minecraft:' + item, 'required': count,
                  'rewardEmerald': reward, 'phase': 'reserved', 'startedAt': int(time.time() * 1000)}
        atomic_json(path, record)
        try:
            # Reserve the exact shared quest before taking goods. Legacy GUI and
            # whisper paths must not accept it while a settlement is uncertain.
            q.update(done=True, done_by=actor, done_at=None, settlement='pending', settlementRequest=record['requestId'])
            atomic_json(npc.quests_path(doc['date']), doc)
            npc.QUESTS.update(date=doc['date'], doc=doc)
            npc.sync_offers()
            raw = npc.R.cmd('clear %s minecraft:%s %d' % (actor, item, count))
            removed = re.search(r'^Removed (\d+) item(?:\(s\)|s)? from player ' + re.escape(actor) + r'\.?$', raw or '')
            goods_after = inventory.count_item(npc, actor, 'minecraft:' + item)
            record['goodsAfter'] = goods_after
            if not removed or int(removed[1]) != count or available - goods_after != count:
                record.update(phase='outcome_unknown', goodsRemoved=int(removed[1]) if removed else None)
                atomic_json(path, record)
                return reply('outcome_unknown', '收货数量未得到完整确认，已停止结算；不会盲目补货或重复收货。', receipt=record)
            record.update(phase='goods_removed', goodsRemoved=count)
            atomic_json(path, record)
            if reward:
                emerald_before_reward = inventory.count_item(npc, actor, 'minecraft:emerald')
                record['emeraldBeforeReward'] = emerald_before_reward
                atomic_json(path, record)
                raw = npc.R.cmd('give %s minecraft:emerald %d' % (actor, reward))
                given = re.search(r'^(?:Gave|Given) (\d+) .+ to ' + re.escape(actor) + r'\.?$', raw or '')
                emerald_after = inventory.count_item(npc, actor, 'minecraft:emerald')
                record['emeraldAfter'] = emerald_after
                if not given or int(given[1]) != reward or emerald_after - emerald_before_reward != reward:
                    record.update(phase='outcome_unknown')
                    atomic_json(path, record)
                    return reply('outcome_unknown', '材料已收取，奖品发放结果需要核对，不会重复发奖。', receipt=record)
            record.update(phase='reward_paid', emeraldGiven=reward)
            atomic_json(path, record)
            effect = q.get('effect')
            if effect:
                if not isinstance(effect, str) or not ITEM.fullmatch(effect):
                    raise ValueError('invalid_contract_effect')
                raw = npc.R.cmd('effect give %s minecraft:%s 60 0' % (actor, effect))
                if not re.search(r'^Applied effect .+ to ' + re.escape(actor), raw or ''):
                    raise ValueError('contract_effect_outcome_unknown')
                record['effectApplied'] = 'minecraft:' + effect
                atomic_json(path, record)
            q.update(done_at=time.strftime('%H:%M'), settlement='completed')
            atomic_json(npc.quests_path(doc['date']), doc)
            npc.QUESTS.update(date=doc['date'], doc=doc)
            # Existing gather completion only awards fame: emeralds came from
            # the verified NPC exchange above. It never awards them twice.
            if task:
                task['taker'] = [actor]
                if not guild.settle_gather(qid, actor):
                    raise ValueError('guild_fame_outcome_unknown')
            record.update(phase='completed', fameRecorded=task.get('fame', 1) if task else 0,
                          finishedAt=int(time.time() * 1000))
            if q.get('lore_atom'):
                atoms = npc.load_atoms()
                clue = next((a['words'][0] for a in atoms if isinstance(a, dict) and isinstance(a.get('words'), list)
                             and a['words'] and isinstance(a['words'][0], str)), None)
                if clue:
                    record['spellClue'] = clue[:64]
            atomic_json(path, record)
            try:
                npc.ledger_append({'type': 'guild-delivery', 'requestId': record['requestId'], 'player': actor,
                                   'date': doc['date'], 'item': item, 'count': count, 'emerald': reward, 'guildFame': record['fameRecorded']})
            except Exception:
                pass  # The durable transaction above is the authoritative receipt.
            return reply('completed', '实际材料已交付，柜台奖品与公会功勋已结算。', True, receipt=record)
        except Exception:
            record['phase'] = 'outcome_unknown'
            atomic_json(path, record)
            return reply('outcome_unknown', '交割过程中断，已保存核对记录；不会自动重复扣货或发奖。', receipt=record)


class GuildService:
    def __init__(self, npc, guild):
        self.npc, self.guild = npc, guild

    def _identity(self, actor, expected):
        raw = self.npc.R.cmd('data get entity %s UUID' % actor)
        match = re.search(r'\[I;\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\]', raw or '')
        if not match:
            return False
        actual = str(uuid.UUID(bytes=b''.join((int(n) & 0xffffffff).to_bytes(4, 'big') for n in match.groups())))
        return actual == expected

    def query(self, actor):
        from npc_identity import historical_location
        doc = self.guild.board_today()
        quests = []
        fame = self.guild.load_fame().get(actor, {})
        active_count = sum(b.get('status') == 'claimed' and actor in self.guild._takers(b) for b in doc['board'])
        nearby = near_npc(self.npc, actor, next((p for p in self.npc.PROFILES if p.get('key') == 'guild_lan'), None),
                          self.guild.GCFG.get('claim_proximity', 8))
        for b in doc['board'][:24]:
            profile = next((p for p in self.npc.PROFILES if p.get('key') == b.get('from')), None)
            pos = self.npc.alive_pos(profile) if profile else None
            blocked = self.guild._new_claim_block(b)
            supported = b.get('type') in ('gather', 'hunt', 'visit') and not b.get('party')
            if supported and not blocked and b['status'] == 'open':
                blocked = self.guild._rank_gate(actor, b)
                if not blocked and active_count >= self.guild.GCFG.get('active_cap', 1):
                    blocked = '本人已有未完成委托，须先完成或放弃。'
                if not blocked and not nearby:
                    blocked = '尚未确认与公会接待员处于同一维度且在柜台附近。'
            objective = None
            if b['type'] == 'hunt':
                objective = {'mobId': 'minecraft:' + b['mob'], 'count': b['count'],
                             'baseline': (b.get('baseline') or {}).get(actor)}
            elif b['type'] == 'visit':
                far = self.guild._is_far_horizon(b)
                objective = {'dimension': 'minecraft:overworld', 'destination': list(b['pos']) if valid_position(b.get('pos')) and not far else None,
                             'radius': None if far else b.get('r'), 'minDistanceFromPlaza': 300 if far else None,
                             'plaza': list(self.guild.PLAZA) if far else None}
            quests.append({'questId': '%s:%d' % (doc['date'], b['no']), 'no': b['no'], 'type': b['type'],
                'title': str(b.get('title', ''))[:160], 'status': b['status'], 'claimedBy': self.guild._takers(b),
                'itemId': 'minecraft:' + b['item'] if b.get('item') else None, 'count': b.get('count'),
                'rewardEmerald': b.get('reward'), 'fame': b.get('fame', 1),
                'rankRequired': b.get('rank', 0), 'objective': objective, 'rewardOutcome': b.get('rewardOutcome'),
                'issuer': {'key': b.get('from'), 'label': str(b.get('display', ''))[:80],
                           **historical_location(profile), 'positionFresh': valid_position(pos),
                           'position': list(pos) if valid_position(pos) else None, 'dimension': 'minecraft:overworld'},
                'claimable': supported and not blocked and b['status'] == 'open',
                'blockedReason': blocked or (None if supported else '旧造景与组队战利品任务未开放'),
                'acceptance': '向发单人交付真实材料' if b['type'] == 'gather' else '实际新增击杀自动验收' if b['type'] == 'hunt' else '实际到达地点自动验收'})
        reception = next((p for p in self.npc.PROFILES if p.get('key') == 'guild_lan'), None)
        pos = self.npc.alive_pos(reception) if reception else None
        return reply('guild_observed', '公会尚无已绑定且职业匹配的接待员或发单人。' if doc.get('availability', {}).get('ok') is False else '现有公会看板与本人功勋。', True,
            boardDate=doc['date'], quests=quests, availability=doc.get('availability'),
            observedAt=int(time.time() * 1000), fame={k: fame.get(k) for k in ('fame', 'done', 'rank', 'joined')},
            receptionist={'key': 'guild_lan', 'position': list(pos) if valid_position(pos) else None,
                          **historical_location(reception), 'positionFresh': valid_position(pos),
                          'dimension': 'minecraft:overworld'}, truncated=len(doc['board']) > 24)

    def execute(self, request):
        actor, action = request['actor'], request['action']
        with self.guild.state_lock():
            if not self._identity(actor, request.get('actorUuid')):
                return reply('actor_mismatch', '实际在线角色身份与请求不符。')
            if action == 'query':
                return self.query(actor)
            match = QUEST.fullmatch(request['questId'])
            doc = self.guild.board_today()
            if match[1] != doc['date']:
                return reply('quest_expired', '这是另一日的委托编号，请重新查看今日看板。')
            b = next((row for row in doc['board'] if row['no'] == int(match[2])), None)
            if not b:
                return reply('quest_not_found', '今日看板没有这笔委托。')
            if b['type'] not in ('gather', 'hunt', 'visit') or b.get('party'):
                return reply('unsupported_contract', '旧造景、召唤首领及组队战利品任务未开放。')
            if action == 'claim':
                lines = self.guild.claim(actor, b['no'])
                ok = b['status'] == 'claimed' and self.guild._takers(b) == [actor]
                return reply('claimed' if ok else 'claim_refused', '\n'.join(lines)[:600], ok, questId=request['questId'])
            if b['status'] != 'claimed' or self.guild._takers(b) != [actor]:
                return reply('quest_not_owned', '这笔委托当前不在你名下。')
            if action == 'release':
                lines = self.guild.release(actor, b['no'])
                return reply('released', '\n'.join(lines)[:600], True, questId=request['questId'])
            if b['type'] != 'gather':
                return reply('automatic_acceptance', '此任务依据真实击杀或位置自动验收，无需交付物品。')
            profile = next((p for p in self.npc.PROFILES if p.get('key') == b.get('from')), None)
            q = next((q for q in self.npc.quests_today()['quests'] if q.get('id') == b.get('qid')), None)
            if not q or not self.guild._gather_matches(b):
                return reply('quest_changed', '看板与今日柜台货单不一致。')
            return deliver_quest(self.npc, self.guild, actor, profile, q, request['id'], request['actorUuid'])


def validate_request(value, identity, now):
    if (not isinstance(value, dict) or value.get('id') != identity or not ACTOR.fullmatch(value.get('actor', ''))
            or not isinstance(value.get('actorUuid'), str) or not ID.fullmatch(value['actorUuid'])
            or value.get('action') not in ('query', 'claim', 'release', 'deliver')):
        raise ValueError('invalid_request')
    if value['action'] != 'query':
        match = QUEST.fullmatch(value.get('questId', ''))
        if not match:
            raise ValueError('invalid_request')
        date.fromisoformat(match[1])
    elif value.get('questId') is not None:
        raise ValueError('invalid_request')
    for key in ('submittedAt', 'expiresAt'):
        if type(value.get(key)) not in (int, float) or not math.isfinite(value[key]):
            raise ValueError('invalid_request')
    if not 0 <= value['expiresAt'] - value['submittedAt'] <= 60000:
        raise ValueError('invalid_request')
    if value['submittedAt'] > now + 5000 or value['expiresAt'] < now:
        raise ValueError('expired')


class GuildQueue:
    def __init__(self, root, service, clock=lambda: int(time.time() * 1000)):
        self.root, self.service, self.clock = Path(root), service, clock
        if self.root.is_symlink():
            raise ValueError('linked_guild_queue')
        for name in ('requests', 'processing', 'results', 'duplicates'):
            path = self.root / name
            if path.is_symlink():
                raise ValueError('linked_guild_queue')
            path.mkdir(parents=True, exist_ok=True)
        for path in (self.root / 'processing').iterdir():
            if ID.fullmatch(path.name) and not (self.root / 'results' / (path.name + '.json')).exists():
                try:
                    previous = read(path / 'request.json')
                    actor, actor_uuid = previous.get('actor', ''), previous.get('actorUuid')
                except Exception:
                    actor, actor_uuid = '', None
                self.publish(path.name, actor, reply('outcome_unknown', '先前执行中断，不能自动重放。'), actor_uuid)

    def publish(self, identity, actor, result, actor_uuid=None):
        atomic_json(self.root / 'results' / (identity + '.json'), result | {
            'requestId': identity, 'actor': actor, 'actorUuid': actor_uuid, 'finishedAt': self.clock(), 'retryAutomatically': False})

    def poll(self):
        candidates = [path for path in (self.root / 'requests').iterdir() if ID.fullmatch(path.name)
                      and not path.is_symlink() and (path / 'request.json').is_file()]
        for path in sorted(candidates)[:8]:
            identity = path.name
            if path.is_symlink() or not ID.fullmatch(identity) or not (path / 'request.json').is_file():
                continue
            target = self.root / 'processing' / identity
            if target.exists():
                path.rename(self.root / 'duplicates' / (identity + '-' + uuid.uuid4().hex))
                continue
            path.rename(target)
            if (self.root / 'results' / (identity + '.json')).exists():
                continue
            actor, actor_uuid = '', None
            try:
                request = read(target / 'request.json')
                actor = request.get('actor') if isinstance(request.get('actor'), str) else ''
                actor_uuid = request.get('actorUuid')
                validate_request(request, identity, self.clock())
            except (ValueError, TypeError, OSError) as exc:
                self.publish(identity, actor, reply('expired' if str(exc) == 'expired' else 'invalid_request', '请求无效或过期，未执行。'), actor_uuid)
                continue
            try:
                result = self.service.execute(request)
            except Exception:
                result = reply('outcome_unknown', '执行结果需要核对，不能自动重放。')
            self.publish(identity, actor, result, actor_uuid)


def run(npc):
    global _LAST_POLL, _NPC_HEALTH
    import mc_guild
    from npc_identity import required_npc_health
    queue = GuildQueue(os.environ['NPC_GUILD_QUEUE'], GuildService(npc, mc_guild))
    while True:
        queue.poll()
        _LAST_POLL = time.time()
        if time.time() - _NPC_HEALTH.get('checked_at', 0) > 30:
            _NPC_HEALTH = required_npc_health(npc, mc_guild)
        time.sleep(.25)
