"""Content proposals and append-only publication through the existing NPC guild.

Qwen chooses the story and objectives. This module only validates supported
contracts, records approval, and appends them under the guild's economy lock.
It never runs a model, server command, reward transfer, or background worker.
"""
from copy import deepcopy
from datetime import date, timedelta
import hashlib
import json
import math
from pathlib import Path
import re
import time
import unicodedata

from npc_identity import binding, contract_issuer, valid_position
from npc_planner import QUEST_ITEMS
from qwen_tasks import read_json, write_json, state_lock
from guild_rules import gather_matches, is_far_horizon

ACTORS = ('game:qd-guild-planner', 'game:mc-god', 'operations:mc-priest')
# Terminal publication outcomes (see _publish_one). A proposal record must
# never keep reporting 'proposed' once its receipt reached one of these:
# receipts are authoritative for the top-level status shown by read().
TERMINAL_PUBLICATION = ('published', 'blocked', 'expired')
ID = re.compile(r'[A-Za-z0-9_-]{1,80}\Z')
CONTENT_ID = re.compile(r'content-[a-f0-9]{24}\Z')
# Contract takedown requests (see ContentQueue.withdraw and _withdraw_one).
# Same receipt-authority rule as TERMINAL_PUBLICATION: a withdraw request
# never keeps reporting queued once its receipt reached one of these.
WITHDRAW_ID = re.compile(r'withdraw-[a-f0-9]{24}\Z')
WITHDRAW_TERMINAL = ('withdrawn', 'rejected')
MOBS = {'skeleton': '骷髅', 'zombie': '僵尸', 'spider': '蜘蛛'}
# The gateway goto pre-check (world/survival/numen_gateway.py, action()) rejects
# a single goto whose horizontal displacement — math.hypot on x/z only, y never
# participates — exceeds this many blocks; goto is walk-only with strict
# arrival. Value re-verified 2026-09-15 (case-fe0b3f68 seq309). The constant
# itself lives outside this file, so tests pin the copied default instead of
# trusting the copy silently.
GOTO_SINGLE_HOP_LIMIT = 24
# One tp cast (world/survival/game_skills.py preflight_game_action) moves at
# most 30 blocks along one of eight fixed compass directions, and the featured
# legacy skill costs 20 mana per cast (skills board, team_context 2026-09-15).
# Same pinning rule as GOTO_SINGLE_HOP_LIMIT: the source lives outside this
# file, tests keep the copies honest.
TP_SINGLE_CAST_LIMIT = 30
TP_CAST_MANA = 20
# Observed water corridors (case-52f0d5bb65c49ef1cb2a, 2026-09-15). Each entry
# records real observed positions with their evidence sources — never a
# surveyed river shape. A travel segment that crosses or even touches the
# bank-to-bank connector MIGHT have to cross the observed water, so the
# reachability answer flags it instead of offering a plain walking relay; no
# flag never means the terrain elsewhere is clear. Only real in-world
# receipts confirm any leg. Dispatch-time enforcement of these corridors in
# world/survival/numen_gateway.py (goto refusal before the walk is sent) is a
# PARKED code candidate — world/survival/ sits outside the only fixed test
# plan's coverage, so it has not landed; this advisory copy is the live half
# and the pinning home. Entry semantics: 'banks' holds the observed pair
# (east point, west point) and minWidthBlocks is the confirmed in-water
# LOWER bound along that connector — for the north pocket the west point is
# an in-water wading observation, not a dry west bank, and the pocket's west
# edge was never observed (ruling on rivercase-18/19, case-b29410d5d257b5c1387b).
OBSERVED_WATER_CROSSINGS = (
    {'id': 'village-camp-river-2026-09-15',
     'banks': ((-582.8, 847.3), (-639.0, 1055.0)),
     'minWidthBlocks': 70,
     'observedAt': '2026-09-15',
     'sources': ('goddess-inspect-20260915-rivercase-1',
                 'admin-receipt:goddess-rescue-20260915-rivercase-1:native_teleport_confirmed',
                 'case-fe0b3f68e8db75ca00fb:turn-survival-31477b791a7443e3b32fd6ae6e6c63cf',
                 'case-0956bd215e5a4c7b0699:camp-reference',
                 'goddess-rescue-20260915-rivercase-2:native_teleport_confirmed',
                 'goddess-rescue-20260915-rivercase-3:native_teleport_confirmed',
                 'case-3c85d05fe93243fca371:seq442-fourth-stall-double-observed')},
    {'id': 'river-north-pocket-2026-09-15',
     'banks': ((-596.36, 805.46), (-602.51, 804.51)),
     'minWidthBlocks': 3,
     'observedAt': '2026-09-15',
     'sources': ('goddess-inspect-20260915-rivercase-18:yui-east-dry-y63',
                 'goddess-inspect-20260915-rivercase-19:yui-west-wading-y61.6-moving',
                 'case-3c85d05fe93243fca371:rivercase-9-19-kirito-stall-y59-in-water')},
)
# Adapter progress for case boss-chest-adapter-missing: the four receipt
# capabilities map to scout/place/proof/cleanup; 'ledger' is the durable
# receipt store underneath them (SiteQueue, implemented and covered by
# offline tests; slice two exposes it to roles through world_content_tools
# so the repairOwner can propose/approve/record/recover venues via MCP).
# 'implemented' never means the server-facing step ran, so scout/place/
# proof/cleanup stay 'planned' until a real server bridge appends receipts.
BLOCKED = {
    'boss': {'ready': False, 'code': 'boss_adapter_missing',
             'missing': ['勘察并确认场地', '原生生成前后UUID回执', '绑定本次首领的击杀证明', '清理与未知状态恢复'],
             'steps': {'scout': 'planned', 'place': 'planned', 'proof': 'planned', 'cleanup': 'planned',
                       'ledger': 'implemented'},
             'repairOwner': 'game:mc-god'},
    'chest': {'ready': False, 'code': 'chest_adapter_missing',
              'missing': ['勘察并确认场地', '方块与物品放置前后回执', '本次宝箱战利品归属证明', '未知状态恢复'],
              'steps': {'scout': 'planned', 'place': 'planned', 'proof': 'planned', 'cleanup': 'planned',
                        'ledger': 'implemented'},
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
    issuer_keys = {p['key'] for p in issuers}
    days = {}
    for day in (current, current + timedelta(days=1)):
        name = day.isoformat()
        board_path = Path(guild.guild_path(name))
        board = load(board_path) if board_path.exists() else {'date': name, 'board': []}
        quest_path = Path(npc.quests_path(name))
        quests = load(quest_path) if quest_path.exists() else {'date': name, 'quests': []}
        # issuerReady is read-only visibility (case contract-takedown-tool-missing):
        # a board contract whose issuer left the roster stays listed with its
        # real status instead of silently vanishing; it flags the delivery
        # dead-end, never auto-expires the contract.
        rows = [{'questId': name + ':' + str(b['no']), 'title': b['title'], 'type': b['type'],
                 'issuer': b.get('from'), 'issuerReady': b.get('from') in issuer_keys,
                 'status': b['status'], 'objective': objective(b),
                 'objectiveSha256': digest(objective(b))}
                for b in board['board'] if b['type'] in ('gather', 'hunt', 'visit') and not b.get('party')
                and (b['type'] != 'gather' or gather_matches(b, quests['quests']))
                and (b['type'] != 'visit' or is_far_horizon(b))]
        days[name] = {'contracts': rows,
            'issuerMissingContracts': [r['questId'] for r in rows if not r['issuerReady']],
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
                             'withdraw': {'ready': True, 'operator': 'game:mc-god',
                                          'request': 'world_content_withdraw(request_id, day, no, reason)',
                                          'contractStatusAfter': 'withdrawn',
                                          'acceptance': 'world_content_context lists the questId with status withdrawn; guild claim/delivery refuse it'},
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


def _reachability_axes(point, code):
    require(isinstance(point, dict) and type(point.get('x')) in (int, float)
            and type(point.get('z')) in (int, float), code)
    return float(point['x']), float(point['z'])


def _segments_cross(p1, p2, p3, p4):
    """True when 2-D segments p1-p2 and p3-p4 properly cross or touch."""
    def turn(p, q, r):
        cross = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
        return 0 if abs(cross) <= 1e-9 else (1 if cross > 0 else -1)

    def between(p, q, r):
        return (min(p[0], r[0]) - 1e-9 <= q[0] <= max(p[0], r[0]) + 1e-9
                and min(p[1], r[1]) - 1e-9 <= q[1] <= max(p[1], r[1]) + 1e-9)

    d1, d2 = turn(p3, p4, p1), turn(p3, p4, p2)
    d3, d4 = turn(p1, p2, p3), turn(p1, p2, p4)
    if ((d1 > 0 > d2) or (d1 < 0 < d2)) and ((d3 > 0 > d4) or (d3 < 0 < d4)):
        return True
    return ((d1 == 0 and between(p3, p1, p4)) or (d2 == 0 and between(p3, p2, p4))
            or (d3 == 0 and between(p1, p3, p2)) or (d4 == 0 and between(p1, p4, p2)))


def _observed_water_crossings(travel_from, travel_to):
    """Advisory flags for straight travel segments touching an observed corridor.

    Pure arithmetic over recorded observations; a flag is a warning to verify,
    never proof that the leg is blocked, and the tp relay arithmetic is an
    estimate, never a cast permission or a landing guarantee.
    """
    rows = []
    for barrier in OBSERVED_WATER_CROSSINGS:
        (ex, ez), (wx, wz) = barrier['banks']
        if _segments_cross(travel_from, travel_to, (ex, ez), (wx, wz)):
            casts = math.ceil(barrier['minWidthBlocks'] / TP_SINGLE_CAST_LIMIT)
            rows.append({'id': barrier['id'], 'minWidthBlocks': barrier['minWidthBlocks'],
                         'observedAt': barrier['observedAt'], 'sources': list(barrier['sources']),
                         'tpSingleCastLimit': TP_SINGLE_CAST_LIMIT,
                         'tpRelayCasts': casts, 'tpManaEstimate': casts * TP_CAST_MANA})
    return rows


def classify_reachability(target, anchor, waypoints=()):
    """Horizontal accounting for one contract destination; pure geometry.

    Same yardstick as the gateway goto pre-check: y never participates and
    one goto covers at most GOTO_SINGLE_HOP_LIMIT blocks. A relay suggestion
    is a decomposition to verify, never proof of reachability — only real
    in-world goto receipts can confirm each leg. Water corridors enter only
    as observed-corridor flags with their evidence sources; they warn that a
    leg may be un-walkable, they do not survey the river.
    """
    tx, tz = _reachability_axes(target, 'invalid_reachability_target')
    ax, az = _reachability_axes(anchor, 'invalid_reachability_anchor')
    distance = math.hypot(tx - ax, tz - az)
    hops = math.ceil(distance / GOTO_SINGLE_HOP_LIMIT)
    if distance <= GOTO_SINGLE_HOP_LIMIT:
        band = 'single_hop'
        suggestion = '单次goto水平可达，无需前置；仍以实际goto回执为准。'
    elif distance <= 2 * GOTO_SINGLE_HOP_LIMIT:
        band = 'relay_within_two_hops'
        suggestion = '超单跳上限：标注「空间传送/御空术」前置，或拆成两段每段≤24格的中继；中继实测前不算已验证可达。'
    else:
        band = 'beyond_two_hops'
        suggestion = '两跳仍不可达：仅向有传送能力的玩家推荐，或重设目的地。'
    legs = []
    for waypoint in waypoints or ():
        wx, wz = _reachability_axes(waypoint, 'invalid_reachability_waypoint')
        first, second = math.hypot(wx - ax, wz - az), math.hypot(tx - wx, tz - wz)
        if first <= GOTO_SINGLE_HOP_LIMIT and second <= GOTO_SINGLE_HOP_LIMIT:
            legs.append((max(first, second), waypoint))
    relay = None
    if legs:
        max_leg, waypoint = min(legs, key=lambda leg: leg[0])
        relay = {axis: waypoint[axis] for axis in ('x', 'y', 'z') if axis in waypoint}
        relay['name'] = waypoint.get('name')
        relay['maxLeg'] = round(max_leg, 1)
    crossings = _observed_water_crossings((ax, az), (tx, tz))
    if crossings:
        widest = max(row['minWidthBlocks'] for row in crossings)
        casts = math.ceil(widest / TP_SINGLE_CAST_LIMIT)
        suggestion += ('跨水警示：该直线与已观测跨水走廊相交（%s），walk_only 不可渡水，'
                       '上述中继只是几何拆分；需实测绕行或评估 tp 分跳'
                       '（每跳≤%d格、约%d跳、估%d法力；tp 受固定方向、落点安全、'
                       '城镇保护区与工作区校验，中途落点可用性未实测）；实测回执前不算可达。'
                       % ('、'.join(row['id'] for row in crossings), TP_SINGLE_CAST_LIMIT,
                          casts, casts * TP_CAST_MANA))
    return {'horizontalDistance': round(distance, 1), 'requiredHops': hops,
            'singleHopLimit': GOTO_SINGLE_HOP_LIMIT, 'band': band,
            'relayViaWaypoint': relay, 'waterCrossings': crossings, 'suggestion': suggestion}


class ContentQueue:
    def __init__(self, state=Path('/team'), *, clock=time.time):
        self.root, self.clock = safe(Path(state) / 'content'), clock

    def context(self):
        try:
            value = load(self.root / 'context.json')
            require(value['schema'] == 1 and -5 <= self.clock() - value['updatedAt'] <= 120, 'stale_content_context')
            return {'ok': True, **value}
        except (OSError, ValueError, KeyError, TypeError):
            return {'ok': False, 'code': 'content_context_unavailable', 'capabilities': deepcopy(BLOCKED)}

    def reachability(self, actor, target=None, issuer=None, anchor=None, waypoints=None):
        """Account one contract destination against the goto pre-check limit.

        Pure arithmetic over real coordinates; worldActionsExecuted stays 0.
        Exactly one of target/issuer names the destination: an explicit
        target plus explicit anchor works without fresh context, while an
        issuer lookup or the default guild anchor needs one. A stale context
        is reported, never guessed around.
        """
        require(actor in ACTORS, 'invalid_content_actor')
        require((target is None) != (issuer is None), 'invalid_reachability_source')
        context = None
        if issuer is not None:
            context = self.context()
            require(context.get('ok'), 'content_context_unavailable')
            require(isinstance(issuer, str), 'invalid_content_issuer')
            person = next((p for p in context['issuers'] if p['key'] == issuer), None)
            require(person is not None, 'content_issuer_unavailable')
            target = {'x': person['position'][0], 'y': person['position'][1], 'z': person['position'][2]}
        if anchor is None:
            context = context or self.context()
            require(context.get('ok'), 'content_context_unavailable')
            origin = context['destinations']['far_horizon']['origin']
            anchor = {'x': origin[0], 'y': origin[1], 'z': origin[2]}
            anchor_source = 'context_far_horizon_origin'
        else:
            anchor_source = 'explicit'
        result = classify_reachability(target, anchor, waypoints or ())
        return {'ok': True, 'actor': actor,
                'target': {axis: target.get(axis) for axis in ('x', 'y', 'z')},
                'anchor': {axis: anchor.get(axis) for axis in ('x', 'y', 'z')},
                'anchorSource': anchor_source, **result, 'worldActionsExecuted': 0}

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
        receipt = load(publication) if publication.exists() else None
        if (isinstance(receipt, dict) and row.get('status') == 'proposed'
                and receipt.get('status') in TERMINAL_PUBLICATION):
            # A terminal publication receipt wins over a proposal record that
            # missed the update, so world_content_read never answers
            # status='proposed' beside a published/blocked/expired receipt.
            # This stays read-only (publish/tick heal the durable record);
            # read() also runs inside their locks.
            row = {**row, 'status': receipt['status'], 'statusSource': 'publication'}
        return {'ok': True, **row, 'publication': receipt}

    def _sync_proposal_status(self, content_id, status):
        """Publication receipts are authoritative: when one reaches a
        terminal outcome the proposal record's top-level status follows, so
        acceptance shifts never re-approve or misread already-published
        content (case content-read-top-status-vs-publication-published)."""
        require(status in TERMINAL_PUBLICATION, 'invalid_content_publication_status')
        path = self.root / 'proposals' / (content_id + '.json')
        if not path.exists():
            return
        row = load(path)
        if row.get('status') == 'proposed' and row.get('contentId') == content_id:
            row['status'] = status
            save(path, row)

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

    def withdraw(self, actor, request_id, day, no, reason=''):
        """Queue one board-contract takedown for the supervised content tick.

        case contract-takedown-tool-missing: the issuing NPC may leave the
        roster while its contract still sits on the board, leaving players
        unable to deliver. This submit side only pins the contract identity
        (objective sha256) from fresh context and writes a durable request;
        the board itself is changed by tick/_withdraw_one under the guild
        economy lock, with before/after receipts. Replaying the same request
        id returns the terminal receipt once one exists — checked before the
        fresh-context gates, because an executed takedown legitimately no
        longer passes them — while a different payload under the same id is
        a conflict, exactly like publish/submit.
        """
        require(actor == 'game:mc-god', 'content_administrator_required')
        require(isinstance(request_id, str) and ID.fullmatch(request_id), 'invalid_content_actor_or_request')
        require(isinstance(day, str), 'invalid_withdraw_day')
        require(type(no) is int and 1 <= no <= 99, 'invalid_withdraw_number')
        note = text(reason, 120) if isinstance(reason, str) and reason.strip() else ''
        payload_sha = digest([day, no, note])
        withdraw_id = 'withdraw-' + digest([actor, request_id])[:24]
        path = self.root / 'withdraw' / (withdraw_id + '.json')
        with state_lock(self.root):
            if path.exists():
                old = load(path)
                require(old['payloadSha256'] == payload_sha, 'withdraw_request_conflict')
                receipt_path = self.root / 'receipts' / (withdraw_id + '.json')
                receipt = load(receipt_path) if receipt_path.exists() else None
                if isinstance(receipt, dict) and receipt.get('status') in WITHDRAW_TERMINAL:
                    return {'ok': True, 'code': 'withdraw_' + receipt['status'], 'withdrawId': withdraw_id,
                            'receipt': receipt, 'worldActionsExecuted': 0}
                return {'ok': True, 'code': 'withdraw_queued', 'withdrawId': withdraw_id, 'worldActionsExecuted': 0}
            context = self.context()
            require(context.get('ok'), 'content_context_unavailable')
            require(day in context['days'], 'invalid_withdraw_day')
            quest_id = day + ':' + str(no)
            contract = next((c for c in context['days'][day]['contracts'] if c['questId'] == quest_id), None)
            require(contract is not None, 'content_contract_unavailable')
            require(contract['status'] != 'withdrawn', 'withdraw_contract_withdrawn')
            require(contract['status'] in ('open', 'claimed'), 'withdraw_contract_not_active')
            request = {'schema': 1, 'withdrawId': withdraw_id, 'actor': actor, 'requestId': request_id,
                       'day': day, 'no': no, 'questId': quest_id, 'reason': note,
                       'objectiveSha256': contract['objectiveSha256'],
                       'payloadSha256': payload_sha, 'requestedAt': self.clock(),
                       'worldActionsExecuted': 0}
            save(path, request)
        return {'ok': True, 'code': 'withdraw_queued', 'withdrawId': withdraw_id, 'worldActionsExecuted': 0}


SITE_KINDS = ('boss', 'chest')
SITE_STEPS = ('scout', 'place', 'proof', 'cleanup')
SITE_ID = re.compile(r'site-[a-f0-9]{24}\Z')
SITE_RESULT = dict(zip(SITE_STEPS, ('scouted', 'placed', 'proven', 'closed')))
SITE_PREVIOUS = dict(zip(SITE_STEPS, ('approved', 'scouted', 'placed', 'proven')))
SITE_DISTANCE = {'boss': (120, 300), 'chest': (60, 200)}


class SiteQueue:
    """Durable venue ledger for the planned boss/chest adapters.

    Slice one of case boss-chest-adapter-missing: receipt storage, ordered
    transitions and crash recovery are implemented and verified offline. This
    class never runs a server command; the future server bridge may only
    append step receipts here, and a receipt missing after the record claimed
    it stays explicitly unknown instead of being re-derived.
    """

    def __init__(self, state=Path('/team'), *, anchor=(0, 64, 0), clock=time.time):
        self.root, self.anchor, self.clock = safe(Path(state) / 'sites'), tuple(anchor), clock

    def _path(self, site_id):
        require(isinstance(site_id, str) and SITE_ID.fullmatch(site_id), 'invalid_site_id')
        return self.root / 'sites' / (site_id + '.json')

    def _receipt_path(self, site_id, step):
        require(step in SITE_STEPS, 'invalid_site_step')
        return self.root / 'receipts' / (site_id + '-' + step + '.json')

    def _venue_distance(self, venue):
        require(isinstance(venue, dict) and set(venue) == {'x', 'y', 'z'}, 'invalid_site_venue')
        require(all(type(venue[axis]) is int for axis in ('x', 'y', 'z')), 'invalid_site_venue')
        require(-30000000 <= venue['x'] <= 30000000 and -30000000 <= venue['z'] <= 30000000
                and -64 <= venue['y'] <= 380, 'invalid_site_venue')
        return ((venue['x'] - self.anchor[0]) ** 2 + (venue['z'] - self.anchor[2]) ** 2) ** 0.5

    def propose(self, actor, request_id, kind, venue, note=''):
        """Register one candidate venue; no world state is touched or assumed."""
        require(actor == 'game:mc-god', 'site_administrator_required')
        require(isinstance(request_id, str) and ID.fullmatch(request_id), 'invalid_site_request')
        require(kind in SITE_KINDS, 'invalid_site_kind')
        distance = self._venue_distance(venue)
        low, high = SITE_DISTANCE[kind]
        require(low <= distance <= high, 'site_venue_distance_out_of_band')
        require(isinstance(note, str), 'invalid_content_text')
        payload = {'kind': kind, 'venue': {axis: venue[axis] for axis in ('x', 'y', 'z')},
                   'note': text(note, 120) if note.strip() else ''}
        site_id = 'site-' + digest([actor, request_id])[:24]
        path = self._path(site_id)
        with state_lock(self.root):
            if path.exists():
                require(load(path)['payloadSha256'] == digest(payload), 'site_request_conflict')
                return {'ok': True, 'code': 'already_proposed', 'siteId': site_id, 'worldActionsExecuted': 0}
            save(path, {'schema': 1, 'siteId': site_id, 'actor': actor, 'requestId': request_id,
                        'kind': kind, 'venue': payload['venue'], 'note': payload['note'],
                        'payloadSha256': digest(payload), 'status': 'proposed',
                        'steps': {step: 'pending' for step in SITE_STEPS}, 'receipts': {},
                        'anchor': list(self.anchor), 'distance': round(distance, 1),
                        'createdAt': self.clock(), 'worldActionsExecuted': 0})
        return {'ok': True, 'code': 'site_proposed', 'siteId': site_id, 'worldActionsExecuted': 0}

    def approve(self, actor, request_id, site_id):
        require(actor == 'game:mc-god', 'site_administrator_required')
        require(isinstance(request_id, str) and ID.fullmatch(request_id), 'invalid_site_request')
        with state_lock(self.root):
            path = self._path(site_id)
            if not path.exists():
                return {'ok': False, 'code': 'site_not_found'}
            row = load(path)
            if row['status'] == 'approved':
                require(row['approvedRequestId'] == request_id, 'site_request_conflict')
                return {'ok': True, 'code': 'already_approved', 'siteId': site_id, 'worldActionsExecuted': 0}
            require(row['status'] == 'proposed', 'site_not_approvable')
            row.update(status='approved', approvedRequestId=request_id, approvedAt=self.clock())
            save(path, row)
        return {'ok': True, 'code': 'site_approved', 'siteId': site_id, 'worldActionsExecuted': 0}

    def record(self, actor, request_id, site_id, step, evidence):
        """Append one step receipt. Evidence comes from the caller's own
        verified channel; replaying identical evidence is idempotent and heals
        a record that missed the update, differing evidence is a conflict."""
        require(actor == 'game:mc-god', 'site_administrator_required')
        require(isinstance(request_id, str) and ID.fullmatch(request_id), 'invalid_site_request')
        require(step in SITE_STEPS, 'invalid_site_step')
        require(isinstance(evidence, dict) and evidence, 'invalid_site_evidence')
        receipt_path = self._receipt_path(site_id, step)
        with state_lock(self.root):
            path = self._path(site_id)
            require(path.exists(), 'invalid_site_id')
            row = load(path)
            require(row['status'] not in ('proposed', 'blocked', 'outcome_unknown'), 'site_step_not_acceptable')
            if receipt_path.exists():
                require(load(receipt_path)['evidenceSha256'] == digest(evidence), 'site_step_conflict')
            else:
                require(row['status'] == SITE_PREVIOUS[step], 'site_step_out_of_order')
                save(receipt_path, {'schema': 1, 'siteId': site_id, 'step': step, 'actor': actor,
                                    'requestId': request_id, 'evidence': deepcopy(evidence),
                                    'evidenceSha256': digest(evidence), 'recordedAt': self.clock()})
            if row['steps'].get(step) != 'recorded':
                row['steps'][step] = 'recorded'
                row['receipts'] = {**row.get('receipts', {}), step: digest(evidence)}
                row['status'] = SITE_RESULT[step]
                save(path, row)
        return {'ok': True, 'code': 'site_step_recorded', 'siteId': site_id, 'step': step,
                'status': row['status'], 'worldActionsExecuted': 0}

    def read(self, actor, site_id):
        require(actor in ACTORS, 'invalid_site_actor_or_id')
        path = self._path(site_id)
        if not path.exists():
            return {'ok': False, 'code': 'site_not_found'}
        return {'ok': True, **load(path)}

    def recover(self, actor, site_id):
        """Reconcile the record against receipts on disk. Receipts win when
        the record missed them; a claimed-but-missing receipt is unknown and
        freezes the site instead of being re-derived or overwritten."""
        require(actor in ACTORS, 'invalid_site_actor_or_id')
        with state_lock(self.root):
            path = self._path(site_id)
            require(path.exists(), 'invalid_site_id')
            row = load(path)
            original_status = row['status']
            recorded, unknown, healed = [], [], []
            for step in SITE_STEPS:
                receipt_path = self._receipt_path(site_id, step)
                claimed = row['steps'].get(step) == 'recorded'
                if receipt_path.exists():
                    recorded.append(step)
                    if not claimed:
                        healed.append(step)
                elif claimed:
                    unknown.append(step)
            changed = False
            for step in healed:
                row['steps'][step] = 'recorded'
                row['receipts'] = {**row.get('receipts', {}), step: load(self._receipt_path(site_id, step))['evidenceSha256']}
                changed = True
            if unknown:
                row['status'] = 'outcome_unknown'
            elif recorded:
                row['status'] = SITE_RESULT[recorded[-1]]
            if changed or row['status'] != original_status:
                save(path, row)
            return {'ok': True, 'siteId': site_id, 'kind': row['kind'], 'status': row['status'],
                    'steps': dict(row['steps']), 'unknown': unknown, 'recovered': healed,
                    'nextStep': (SITE_STEPS[len(recorded)] if not unknown and len(recorded) < len(SITE_STEPS)
                                 and row['status'] != 'proposed' else None),
                    'worldActionsExecuted': 0}


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
    if receipt and receipt['status'] in TERMINAL_PUBLICATION:
        queue._sync_proposal_status(content_id, receipt['status'])
        return receipt
    day = date.fromisoformat(content['date'])
    if day > current:
        return {'contentId': content_id, 'status': 'scheduled', 'date': content['date']}
    if day < current:
        receipt = {'contentId': content_id, 'status': 'expired', 'date': content['date'], 'updatedAt': clock()}
        save(receipt_path, receipt)
        queue._sync_proposal_status(content_id, receipt['status'])
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
                queue._sync_proposal_status(content_id, receipt['status'])
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
        queue._sync_proposal_status(content_id, receipt['status'])
        return receipt


def _withdraw_one(queue, npc, guild, request, current, clock):
    """Apply one queued takedown under the guild lock; receipts decide.

    Same crash contract as _publish_one: the intermediate 'withdrawing'
    receipt is the durable write plan. After a crash a row already marked
    withdrawn on the board only gets its terminal receipt healed — the
    settled board is never rewritten — while a row still open/claimed has
    the write redone. Every terminal outcome carries the board sha256
    before and after the change, so acceptance is rereading the real
    contract state, never trusting the receipt text alone.
    """
    withdraw_id = request['withdrawId']
    require(request.get('actor') == 'game:mc-god' and request.get('schema') == 1
            and isinstance(request.get('day'), str) and type(request.get('no')) is int
            and WITHDRAW_ID.fullmatch(withdraw_id), 'invalid_withdraw_request')
    receipt_path = queue.root / 'receipts' / (withdraw_id + '.json')
    receipt = load(receipt_path) if receipt_path.exists() else None
    if receipt and receipt['status'] in WITHDRAW_TERMINAL:
        return receipt
    day, no = request['day'], request['no']
    if date.fromisoformat(day) > current:
        return {'withdrawId': withdraw_id, 'status': 'scheduled', 'day': day}
    if date.fromisoformat(day) < current:
        receipt = {'schema': 1, 'withdrawId': withdraw_id, 'status': 'rejected',
                   'code': 'withdraw_day_past', 'day': day, 'no': no, 'updatedAt': clock()}
        save(receipt_path, receipt)
        return receipt
    with guild.state_lock():
        board_path = Path(guild.guild_path(day))
        require(board_path.exists(), 'withdraw_board_missing')
        doc = load(board_path)
        row = next((b for b in doc['board'] if b.get('no') == no), None)
        require(row is not None, 'withdraw_contract_missing')
        if digest(objective(row)) != request['objectiveSha256']:
            # The pinned objective moved after the request: the takedown is
            # permanently rejected with a receipt, never silently retried.
            receipt = {'schema': 1, 'withdrawId': withdraw_id, 'status': 'rejected',
                       'code': 'withdraw_contract_changed', 'day': day, 'no': no,
                       'title': row.get('title'), 'updatedAt': clock(),
                       'boardSha256': digest(doc)}
            save(receipt_path, receipt)
            return receipt
        if not receipt:
            receipt = {'schema': 1, 'withdrawId': withdraw_id, 'status': 'withdrawing', 'day': day,
                       'no': no, 'actor': 'game:mc-god', 'requestId': request.get('requestId'),
                       'reason': request.get('reason'), 'objectiveSha256': request['objectiveSha256'],
                       'startedAt': clock(), 'before': {'boardSha256': digest(doc)},
                       'worldActionsExecuted': 0}
            save(receipt_path, receipt)
        released, healed = [], False
        if row.get('status') != 'withdrawn':
            require(row.get('status') in ('open', 'claimed'), 'withdraw_contract_not_active')
            released = list(row.get('taker') or [])
            row.update(status='withdrawn', withdrawnAt=clock(), withdrawnBy='game:mc-god',
                       withdrawId=withdraw_id, taker=[], taken_at=None)
            if row.get('type') == 'boss':
                # The board row is the ledger; a summoned boss entity, if any
                # adapter ever adds one, must not outlive its contract.
                try:
                    killer = getattr(guild, 'kill_boss', None)
                    if killer:
                        killer(no)
                except Exception:
                    pass
            save(board_path, doc)
            if hasattr(guild, 'BOARD'):
                guild.BOARD.update(date=day, doc=doc)
        else:
            healed = True
        receipt.update(status='withdrawn', updatedAt=clock(), title=row.get('title'),
                       type=row.get('type'), after={'boardSha256': digest(load(board_path))})
        if healed:
            receipt['recoveredFromBoard'] = True
        else:
            receipt.update(releasedTakers=released, boardContractsChanged=1)
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
                        {'open':'可接', 'claimed':'有人承接', 'done':'该合同已结算',
                         'withdrawn':'该合同已下架'}.get(by_no[no]['status'], '状态待核对')))
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
        # Takedowns run before publications: a package referencing a contract
        # that is being withdrawn must fail its publication revalidation
        # instead of landing on a dead board row.
        for path in sorted((queue.root / 'withdraw').glob('*.json')):
            try:
                request = load(path)
                require(WITHDRAW_ID.fullmatch(path.stem) and request.get('withdrawId') == path.stem, 'invalid_withdraw_request_file')
                results.append(_withdraw_one(queue, npc, guild, request, current, clock))
            except (OSError, ValueError, TypeError, KeyError) as exc:
                results.append({'withdrawId': path.stem, 'status': 'withdraw_unconfirmed', 'errorType': type(exc).__name__})
        for path in sorted((queue.root / 'publish').glob('*.json')):
            try:
                request = load(path)
                require(CONTENT_ID.fullmatch(path.stem) and request.get('contentId') == path.stem, 'invalid_content_request_file')
                results.append(_publish_one(queue, npc, guild, request, current, clock))
            except (OSError, ValueError, TypeError, KeyError) as exc:
                results.append({'contentId': path.stem, 'status': 'publication_unconfirmed', 'errorType': type(exc).__name__})
        # Reconcile proposal records whose receipts already reached a
        # terminal outcome before the direct status sync existed; receipts
        # win, the record is healed instead of re-derived or left stale.
        for path in sorted((queue.root / 'proposals').glob('*.json')):
            try:
                if not CONTENT_ID.fullmatch(path.stem):
                    continue
                receipt_path = queue.root / 'receipts' / (path.stem + '.json')
                if not receipt_path.exists():
                    continue
                receipt = load(receipt_path)
                if receipt.get('status') in TERMINAL_PUBLICATION:
                    queue._sync_proposal_status(path.stem, receipt['status'])
            except (OSError, ValueError, TypeError, KeyError, AttributeError):
                continue
        context = make_context(npc, guild, today=current, clock=clock)
        save(queue.root / 'context.json', context)
        public = {'schema': 1, 'updatedAt': clock(), 'publications': [{k: r.get(k) for k in
            ('contentId', 'status', 'code', 'date', 'newContracts', 'referencedContracts', 'questIds', 'publishedAt') if k in r}
            for r in results], 'withdrawals': [{k: r.get(k) for k in
            ('withdrawId', 'status', 'code', 'day', 'no', 'title', 'updatedAt') if k in r}
            for r in results if r.get('withdrawId')], 'capabilities': context['capabilities']}
        save(queue.root / 'status.json', public)
        return public
