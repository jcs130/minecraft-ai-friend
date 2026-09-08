"""Actual player magic through the existing /mycli request/receipt mailbox.

This module cannot grant spells, experience, books, or permissions. The world
service checks the body's real level, inventory, mana, cooldowns and catalog.
Only NumenGateway.action may call dispatch, after persisting its one-action lease.
"""
import json
import math
import os
from pathlib import Path
import re
import time
import uuid

from numen_gateway import GatewayError, read_json, write_json

GAME_ACTIONS = ('game_cast', 'game_learn')
ABILITY_ID = re.compile(r'(?:[a-z][a-z0-9_]{0,63}|[a-z0-9_.-]+:[a-z0-9_./-]+)\Z')
PARAM_KEY = re.compile(r'[a-z][a-z0-9_]{0,31}\Z')
PARAM_TEXT = re.compile(r'[A-Za-z0-9_:.\-/\u3400-\u9fff]{1,64}\Z')
REQUEST_ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z')
# All unknown/new spells conservatively retain town protection. These native
# spells or featured legacy effects do not move the actor or damage terrain.
SELF_CASTS = frozenset(('blood_mana', 'feather_boots',
                       'irons_spellbooks:oakskin', 'irons_spellbooks:shield',
                       'irons_spellbooks:invisibility', 'irons_spellbooks:gluttony'))
UNRESOLVED_TRAVEL = frozenset(('home', 'sky_walk', *('irons_spellbooks:' + name for name in (
    'teleport', 'burning_dash', 'angel_wing', 'frost_step', 'ascension', 'blood_step',
    'thunder_step', 'portal', 'recall', 'evasion', 'pocket_dimension', 'volt_strike'))))
DIRECTIONS = {'东': (1, 0), '南': (0, 1), '西': (-1, 0), '北': (0, -1),
              '东南': (math.sqrt(.5), math.sqrt(.5)), '东北': (math.sqrt(.5), -math.sqrt(.5)),
              '西南': (-math.sqrt(.5), math.sqrt(.5)), '西北': (-math.sqrt(.5), -math.sqrt(.5))}


def cached_game_skills(state, now=None):
    """Historical query results only. Reading never enqueues a game command."""
    try:
        view = read_json(Path(state) / 'game-skills.json')
        if view.get('schema') != 1 or not isinstance(view.get('scopes'), dict):
            raise GatewayError('invalid_game_skill_cache')
        current = int(time.time() * 1000) if now is None else now
        return view | {'historicalQuery': True, 'ageMs': max(0, current - view['observedAt']),
                       'notice': '历史真实查询，可能已随背包、等级或法力变化；需最新值时调用game_skills，不会周期自动提交命令。'}
    except (OSError, ValueError, TypeError, KeyError):
        return {'schema': 1, 'available': False, 'historicalQuery': True, 'scopes': {}}


def summarize_game_skills(cache):
    """At most 6 KiB of factual player capability data; never refresh remotely."""
    def number(value):
        if type(value) not in (int, float) or abs(value) > 1e18:
            return None
        return value if math.isfinite(value) else None

    def rows(values, native=False):
        if not isinstance(values, list):
            return []
        result = []
        for row in values[:24]:
            if not isinstance(row, dict) or not isinstance(row.get('id'), str):
                continue
            entry = {'id': row['id'][:100],
                     'name': (row['name'] if isinstance(row.get('name'), str) else row['id'])[:64]}
            for key in ('level', 'mana', *(('cooldownMs',) if native else ())):
                value = number(row.get(key))
                if value is not None:
                    entry[key] = value
            if native and type(row.get('ready')) is bool:
                entry['ready'] = row['ready']
            result.append(entry)
        return result

    source = cache if isinstance(cache, dict) else {}
    scopes = source.get('scopes') if isinstance(source.get('scopes'), dict) else {}
    selected = {}
    for scope in scopes.values():
        if not isinstance(scope, dict) or not isinstance(scope.get('replies'), dict):
            continue
        stamp = number(scope.get('observedAt')) or 0
        for command, receipt in scope['replies'].items():
            if (command in ('status', 'skills', 'spells irons') and isinstance(receipt, dict)
                    and receipt.get('ok') is True and stamp >= selected.get(command, (-1, {}))[0]):
                selected[command] = (stamp, receipt)
    status = selected.get('status', (0, {}))[1]
    legacy = selected.get('skills', (0, {}))[1]
    irons = selected.get('spells irons', (0, {}))[1]
    native = status.get('native') if isinstance(status.get('native'), dict) else {}
    if native.get('ok') is not True:
        native = irons
    progression = status.get('progression') if isinstance(status.get('progression'), dict) else {}
    categories = []
    raw_categories = progression.get('categories')
    if isinstance(raw_categories, list):
        for row in raw_categories[:12]:
            if not isinstance(row, dict) or not isinstance(row.get('id'), str):
                continue
            item = {'id': row['id'][:80], 'available': row.get('available') is True}
            for key in ('level', 'experience', 'points_total', 'points_spent', 'points_left'):
                item[key] = number(row.get(key))
            categories.append(item)
    attributes = native.get('attributes') if isinstance(native.get('attributes'), dict) else {}
    result = {'schema': 1, 'available': bool(selected), 'historicalQuery': True,
              'observedAt': number(source.get('observedAt')),
              'sourceObservedAt': {key: value[0] for key, value in selected.items()},
              'playerLevel': number(legacy.get('playerLevel')),
              'learned': rows(legacy.get('learned')), 'currentlyAvailable': rows(legacy.get('levelGate')),
              'locked': rows(legacy.get('locked')), 'legacySkillsKnown': bool(legacy),
              'availabilityBasis': 'currentlyAvailable is the legacy levelGate: eligible but not learned; casting still checks mana/cooldown/targets.',
              'nativeSpells': rows(irons.get('spells'), native=True),
              'nativeSpellsKnown': isinstance(irons.get('spells'), list),
              'nativeLevel': number(native.get('level')), 'nativeMana': number(native.get('mana')),
              'nativeMaxMana': number(native.get('maxMana')),
              'legacyMana': number(status.get('mana')), 'legacyMaxMana': number(status.get('maxMana')),
              'attributes': {key: number(attributes[key]) for key in (
                  'health', 'maxHealth', 'maxMana', 'manaRegen', 'spellPower', 'spellResist',
                  'cooldownReduction', 'castTimeReduction') if number(attributes.get(key)) is not None},
              'pufferfish': {'known': bool(progression), 'ok': progression.get('ok') is True,
                            'categories': categories},
              'truncated': any(isinstance(legacy.get(key), list) and len(legacy[key]) > 24
                               for key in ('learned', 'levelGate', 'locked'))
                           or (isinstance(irons.get('spells'), list) and len(irons['spells']) > 24)}
    # Count UTF-8 bytes, including long localized names. Keep the fact of an empty
    # equipped-spell list distinct from an absent observation while trimming.
    lists = [result['learned'], result['currentlyAvailable'], result['locked'], result['nativeSpells'], categories]
    while len(json.dumps(result, ensure_ascii=False).encode('utf-8')) > 6000:
        longest = max(lists, key=len)
        if not longest:
            break
        longest.pop()
        result['truncated'] = True
    return result


def owned_skill_books(books, cache):
    """Match current carried tags against a historical, real player skill list.

    A recognized book is not proof of learning. Missing/ambiguous catalog entries
    intentionally produce no skill_id, so callers never have to trial a cast.
    """
    scopes = cache.get('scopes', {}) if isinstance(cache, dict) else {}
    chosen, stamp = None, -1
    for scope in scopes.values() if isinstance(scopes, dict) else ():
        if not isinstance(scope, dict):
            continue
        replies = scope.get('replies', {})
        receipt = replies.get('skills', {}) if isinstance(replies, dict) else {}
        observed = scope.get('observedAt', 0)
        if (isinstance(receipt, dict) and receipt.get('ok') is True
                and isinstance(receipt.get('bookSkills'), list)
                and type(observed) in (int, float) and abs(observed) <= 1e18
                and math.isfinite(observed) and observed >= stamp):
            chosen, stamp = receipt['bookSkills'], observed
    catalog = {}
    for row in (chosen or [])[:256]:
        if (not isinstance(row, dict) or not isinstance(row.get('name'), str)
                or not isinstance(row.get('id'), str) or ':' in row['id']
                or not ABILITY_ID.fullmatch(row['id']) or len(row['name']) > 64):
            continue
        catalog.setdefault(row['name'], []).append(row)
    result = []
    for book in (books if isinstance(books, list) else [])[:12]:
        if (not isinstance(book, dict) or book.get('id') != 'minecraft:written_book'
                or not isinstance(book.get('bookName'), str) or not 1 <= len(book['bookName']) <= 64
                or type(book.get('slot')) is not int or type(book.get('count')) is not int):
            continue
        item = {key: book[key] for key in ('id', 'count', 'slot', 'bookName')}
        matches = catalog.get(book['bookName'], [])
        item.update(recognized=False, recognition='catalog_unavailable' if chosen is None
                    else 'ambiguous' if len(matches) > 1 else 'unrecognized', historicalCatalog=True)
        if chosen is not None:
            item['catalogObservedAt'] = stamp
        if len(matches) == 1:
            row = matches[0]
            item.update(recognized=True, recognition='recognized', skill_id=row['id'], name=row['name'])
            if (type(row.get('requiredLevel')) in (int, float) and abs(row['requiredLevel']) <= 1e6
                    and math.isfinite(row['requiredLevel'])):
                item['requiredLevel'] = row['requiredLevel']
            if row.get('type') in ('active', 'passive'):
                item['type'] = row['type']
            if type(row.get('learned')) is bool:
                item['knownLearned'] = row['learned']
        result.append(item)
    while len(json.dumps(result, ensure_ascii=False).encode('utf-8')) > 6000:
        result.pop()
    return result


def skill_access(replies):
    """Explain existing gateway checks for observed spells, without authorizing a cast."""
    spells = {}
    for command, receipt in replies.items():
        if not isinstance(receipt, dict) or receipt.get('ok') is not True:
            continue
        keys = ('learned', 'levelGate', 'locked') if command == 'skills' else (
            ('spells',) if command == 'spells irons' else ('atoms',) if command.startswith('spells ') else ())
        for key in keys:
            for row in receipt.get(key, []) if isinstance(receipt.get(key), list) else []:
                ability = row.get('id') if isinstance(row, dict) else None
                if not isinstance(ability, str) or not ABILITY_ID.fullmatch(ability):
                    continue
                catalog = row.get('catalog') if isinstance(row.get('catalog'), dict) else {}
                if catalog.get('status') == 'archived':
                    rule = 'archived_no_active_cast'
                elif ability in UNRESOLVED_TRAVEL or (':' in ability and not ability.startswith('irons_spellbooks:')):
                    rule = 'destination_unavailable'
                elif ability in SELF_CASTS:
                    rule = 'self_cast_no_town_exclusion'
                else:
                    rule = 'requires_unprotected_origin'
                spells[ability] = {'id': ability, 'rule': rule,
                                   'checksTargetArea': ability in ('tp', 'spring')}
    return {'spells': list(spells.values())[:256],
            'notice': '这些是现有Agent执行边界，不是施法许可。所有施法仍校验身体、工作区、等级、资源和冷却；tp/spring还校验实际目标范围。destination_unavailable当前不可用于脱困；protected_area拒绝后不要换同类技能反复试。',
            'learning': 'game_learn不受城镇施法排除，但必须持有可识别的真实技能书；当前参悟不扣除书籍。'}


def validate_game_action(tool, args):
    if tool not in GAME_ACTIONS or not isinstance(args, dict):
        raise GatewayError('invalid_game_action')
    expected = {'skill_id', 'params'} if tool == 'game_cast' else {'skill_id'}
    ability = args.get('skill_id')
    if (set(args) != expected or not isinstance(ability, str) or len(ability) > 100
            or not ABILITY_ID.fullmatch(ability)):
        raise GatewayError('invalid_game_skill')
    if tool == 'game_learn':
        if ':' in ability:
            raise GatewayError('native_spell_requires_real_book_or_scroll')
        return
    params = args['params']
    if not isinstance(params, dict) or len(params) > 6 or (':' in ability and params):
        raise GatewayError('invalid_game_skill_params')
    for key, value in params.items():
        if not isinstance(key, str) or not PARAM_KEY.fullmatch(key) or key in ('constructor', 'prototype', '__proto__'):
            raise GatewayError('invalid_game_skill_params')
        if type(value) in (int, float):
            if not math.isfinite(value) or abs(value) > 10000:
                raise GatewayError('invalid_game_skill_params')
        elif not isinstance(value, str) or not PARAM_TEXT.fullmatch(value):
            raise GatewayError('invalid_game_skill_params')


def is_protected_action(tool, args):
    validate_game_action(tool, args)
    return tool == 'game_cast' and args['skill_id'] not in SELF_CASTS


def preflight_game_action(gateway, before, tool, args):
    """Check explicit legacy targets before reserving or sending a mutation.

    This is a bounded preflight, not a server-side protection plugin. Native
    moving spells need an authoritative destination adapter before enabling.
    """
    validate_game_action(tool, args)
    if tool != 'game_cast':
        return
    ability = args['skill_id']
    if ability in UNRESOLVED_TRAVEL or (':' in ability and not ability.startswith('irons_spellbooks:')):
        raise GatewayError('game_skill_destination_unavailable')
    if ability not in ('tp', 'spring'):
        return
    params = args['params']
    distance = params.get('distance', 5 if ability == 'tp' else 2)
    direction = params.get('direction', '东')
    if (set(params) - {'distance', 'direction'} or type(distance) not in (int, float)
            or not math.isfinite(distance) or not 0 <= distance <= (30 if ability == 'tp' else 10)
            or direction not in DIRECTIONS):
        raise GatewayError('invalid_game_skill_target')
    dx, dz = DIRECTIONS[direction]
    origin = before['position']
    target = {'x': math.floor(origin['x'] + .5) + dx * distance,
              'z': math.floor(origin['z'] + .5) + dz * distance}
    # WaypointTravel may seek a safe block within horizontal radius two. Include
    # diagonal/rounding tolerance; spring also keeps space for fluid spreading.
    gateway._area(target, margin=4 if ability == 'tp' else 8, protect=True)


def action_command(tool, args):
    validate_game_action(tool, args)
    verb = 'cast' if tool == 'game_cast' else 'learn'
    command = f"{verb} {args['skill_id']}"
    for key, value in sorted(args.get('params', {}).items()):
        command += f' {key}={value}'
    return command


class GameSkills:
    def __init__(self, gateway, queue_root=None, timeout=20, sleep=time.sleep):
        self.gateway = gateway
        self.root = Path(queue_root or os.environ.get('SURVIVOR_SKILL_QUEUE', '/survival-skills-queue'))
        self.state = Path(gateway.state)
        self.timeout, self.sleep = max(0, min(timeout, 25)), sleep

    def _request_path(self, request_id):
        if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
            raise GatewayError('invalid_game_skill_request')
        return self.state / 'game-skill-requests' / (request_id + '.json')

    def receipt(self, request_id):
        try:
            owned = read_json(self._request_path(request_id))
            if owned.get('actor') != self.gateway._settings()['bodyName'] or owned.get('requestId') != request_id:
                raise GatewayError('game_skill_request_not_owned')
            path = self.root / 'results' / (request_id + '.json')
            if not path.exists():
                return {'ok': False, 'code': 'pending', 'requestId': request_id, 'retryAutomatically': False}
            result = read_json(path)
            if (result.get('requestId') != request_id or type(result.get('ok')) is not bool
                    or (result.get('actor') != owned['actor'] and result.get('code') not in ('outcome_unknown', 'expired', 'invalid_request'))):
                raise GatewayError('game_skill_receipt_mismatch')
            return result | {'retryAutomatically': False}
        except (GatewayError, OSError, ValueError, TypeError, KeyError):
            return {'ok': False, 'code': 'game_skill_receipt_unavailable', 'retryAutomatically': False}

    def _request(self, command, mutation=False):
        body, body_uuid = self.gateway._check_binding()
        if self.root.is_symlink() or not self.root.is_dir():
            raise GatewayError('game_skill_queue_unavailable')
        for name in ('requests', 'results'):
            if (self.root / name).is_symlink():
                raise GatewayError('game_skill_queue_unavailable')
        request_id = str(uuid.uuid4())
        now = self.gateway._now()
        request = {'id': request_id, 'actor': body, 'command': command,
                   'submittedAt': now, 'expiresAt': now + 30000}
        write_json(self._request_path(request_id), {'requestId': request_id, 'actor': body,
                   'actorUuid': body_uuid, 'command': command, 'submittedAt': now})
        if mutation:
            marker = read_json(self.state / 'unknown.json')
            if marker.get('tool') not in GAME_ACTIONS or marker.get('result') != 'unknown':
                raise GatewayError('game_skill_requires_action_lease')
            # Correlation survives termination between publishing the request and
            # receiving the world process's answer. Never submit a replacement ID.
            write_json(self.state / 'unknown.json', marker | {'requestId': request_id})
        slot = self.root / 'requests' / request_id
        slot.mkdir(parents=True, exist_ok=False)
        write_json(slot / 'request.json', request)
        deadline = time.monotonic() + self.timeout
        while True:
            result = self.receipt(request_id)
            if result.get('code') != 'pending' or time.monotonic() >= deadline:
                return result
            self.sleep(0.1)

    def query(self, scope='all', page=1):
        if type(page) is not int or not 1 <= page <= 100 or (page != 1 and scope not in ('legacy', 'archive')):
            return {'ok': False, 'code': 'invalid_game_skill_page'}
        suffix = '' if page == 1 else ' ' + str(page)
        routes = {'status': ('status',), 'legacy': ('skills', 'spells legacy'),
                  'archive': ('spells archive' + suffix,),
                  'irons': ('spells irons',), 'help': ('help',),
                  'all': ('status', 'skills', 'spells legacy', 'spells irons')}
        if page != 1:
            routes['legacy'] = ('skills', 'spells legacy' + suffix)
        if scope not in routes:
            return {'ok': False, 'code': 'invalid_game_skill_scope'}
        try:
            replies = {command: self._request(command) for command in routes[scope]}
            result = {'ok': all(row.get('ok') is True for row in replies.values()),
                    'scope': scope, 'page': page, 'actor': self.gateway._settings()['bodyName'],
                    'observedAt': self.gateway._now(), 'replies': replies,
                    'agentPreflight': skill_access(replies),
                    'learning': {
                        'legacy': 'skills.learned是当前开放主动技能中的已学项，levelGate是等级已足但尚未收录项；这些主动技能无需先找书即可正常施放，首次成功后收录。status.learned保留旧进度，不等于所有旧技能仍开放。',
                        'books': 'skills.bookSkills包含可参悟的主动/被动目录。status快照的ownedSkillBooks对应实际携带的技能书；game_learn按原规则验书收录，当前不消耗书，主动施放仍受等级限制。没有书不要盲试；被动无需主动施放。',
                        'irons': '由真实装备的法术书或手持卷轴决定。未列出的法术不等于已拥有；先探索、合成和装备。无直接学习或赠书接口。',
                        'archive': 'game_skills(archive,page)按需查看原/mycli归档原因和nativeHints；替代法术要走真实Iron装备来源，不能直接施放或以旧技能进度兑换。',
                        'programs': 'skill_catalog 是可编程行为库，与游戏法术进度不同。可把已验证的 game_cast/game_learn 用法写为程序技能。'},
                    'notice': '游戏回执是环境数据。只读查询不代表已学会或已经施法；过期或未知回执不能重发。'}
            if result['ok']:
                previous = cached_game_skills(self.state, self.gateway._now())
                scopes = previous['scopes'] | {(scope if page == 1 else f'{scope}:{page}'): result}
                cache = {'schema': 1, 'available': True, 'historicalQuery': True,
                         'actor': result['actor'], 'observedAt': result['observedAt'], 'scopes': scopes}
                if len(json.dumps(cache, ensure_ascii=False, allow_nan=False).encode('utf-8')) <= 196608:
                    write_json(self.state / 'game-skills.json', cache)
            return result
        except (GatewayError, OSError, ValueError, TypeError, KeyError):
            return {'ok': False, 'code': 'game_skill_query_unavailable'}

    def dispatch(self, tool, args):
        command = action_command(tool, args)
        result = self._request(command, mutation=True)
        if result.get('code') in ('pending', 'outcome_unknown', 'bridge_error', 'no_receipt', 'game_skill_receipt_unavailable'):
            raise GatewayError('outcome_unknown')
        return {'success': result.get('ok') is True, 'message': result.get('summary', ''),
                'data': {'receipt': result, 'async': result.get('code') == 'casting_started',
                         'learningConfirmed': result.get('code') in ('learned', 'already_learned')}}
