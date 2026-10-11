"""Real two-owner native Numen play test, invoked only in a fresh isolated server.

No model requests. All give/summon/teleport fixtures are recorded separately from
the native survival actions. Tokens are never included in evidence or output.
"""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
import struct
import time
import uuid


def checks(tool, request, console, owner, other, other_token, body, lease, server, result, report):
    evidence = {'fixtures': [], 'calls': [], 'latencyMs': [], 'paidModelRequests': 0}
    report['guestAcceptance'] = evidence
    path = server.parent / 'guest-acceptance.json'
    def save(): path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
    def check(name, value):
        result[name] = bool(value); evidence.setdefault('checks', {})[name] = bool(value); save()
        assert value, name
    def call(name, args=None, second=False):
        start = time.monotonic()
        value = tool(name, args or {}, other_token) if second else tool(name, args or {})
        evidence['calls'].append({'operation': name, 'arguments': args, 'secondOwner': second, 'result': value})
        evidence['latencyMs'].append((time.monotonic() - start) * 1000)
        save(); return value
    def fixture(command):
        evidence['fixtures'].append(command); save(); console(command); time.sleep(.15)
    def query(operation, args=None, second=False):
        return call('mod_query', {'companion': guest if second else body, 'operation': operation, 'arguments': args or {}}, second)
    def submit(operation, args=None, aid=None, second=False):
        return call('mod_action', {'companion': guest if second else body, 'lease_id': guest_lease if second else lease,
                    'action_id': aid or 'guest-'+uuid.uuid4().hex, 'operation': operation, 'arguments': args or {}}, second)
    def terminal(aid, second=False):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            value = call('action_status', {'companion': guest if second else body, 'action_id': aid}, second)
            if value.get('phase') in ('terminal', 'unknown'): return value
            time.sleep(.2)
        raise TimeoutError('Guest action unknown; do not replay')
    def act(operation, args=None, second=False, aid=None):
        accepted = submit(operation, args, aid, second)
        return terminal(accepted['action_id'], second) if 'phase' in accepted else accepted
    def menu(second=False): return query('menu.snapshot', second=second)['state']
    def held(second=False):
        state = menu(second); stack = state['self']['equipment']['mainhand']
        return {'expectedHotbarSlot': state['selectedHotbarSlot'], 'expectedHeldSnbt': stack['snbt'] if stack else ''}
    def close(second=False):
        state = menu(second)
        return act('menu.close', {'windowId': state['windowId'], 'expectedStateId': state['stateId']}, second)
    def ints(value): return '[I;'+','.join(map(str, struct.unpack('>4i', uuid.UUID(value).bytes)))+']'

    made = call('create_companion', {'name': 'MawGuestBody', 'action_id': 'guest-create-01'}, True)
    guest = made['bodyId']; evidence['bodies'] = [body, guest]
    check('guest_second_owner_real_body', made['online'] and guest != body and made['ownerUuid'] == other)
    guest_lease = call('claim_control', {'companion': guest, 'controller_id': 'guest-controller'}, True)['lease']['leaseId']
    call('set_permission', {'companion': guest, 'lease_id': guest_lease, 'mode': 'bypass'}, True)
    # Lease IDs are capabilities for one specific body, even within the same server.
    wrong = call('mod_action', {'companion': body, 'lease_id': guest_lease, 'action_id': 'guest-forged-lease', 'operation': 'curios.open'})
    check('guest_cross_body_lease_rejected', wrong['code'] == 'control_lease_required' and menu()['windowId'] == 0)
    foreign = call('action_status', {'companion': body, 'action_id': 'qa-native-open'}, True)
    check('guest_private_action_receipt_denied', foreign['code'] == 'body_not_owned')
    check('guest_companion_lists_isolated', {b['bodyId'] for b in call('list_companions')['companions']} == {body}
          and {b['bodyId'] for b in call('list_companions', second=True)['companions']} == {guest})
    # Same action ID on two bodies is independent. Concurrent opens must never
    # capture the other body or share a menu/container state.
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(submit, 'curios.open', None, 'guest-shared-id', second) for second in (False, True)]
        accepted = [f.result() for f in futures]
    terminals = [terminal('guest-shared-id', second) for second in (False, True)]
    check('guest_simultaneous_native_actions_isolated', all(x['phase'] == 'accepted' for x in accepted)
          and all(x['ok'] for x in terminals)
          and [x['outcome']['bodyId'] for x in terminals] == [body, guest]
          and menu()['menuType'] == menu(True)['menuType'] == 'curios:curios_container')
    check('guest_independent_menu_close', close()['ok'] and menu()['windowId'] == 0 and menu(True)['windowId'] != 0 and close(True)['ok'])
    # Reserve one active program. Mod operations cannot become a second writer;
    # another body must remain usable while the first one's action is pending.
    pending = call('lua', {'companion': body, 'lease_id': lease, 'action_id': 'guest-interlock', 'code': 'numen.time.wait(1); print("GUEST_INTERLOCK_DONE")'})
    busy = submit('curios.open', aid='guest-busy-must-not-open')
    independent = act('curios.open', second=True)
    check('guest_lua_native_single_writer', pending['phase'] == 'accepted' and busy['code'] == 'body_busy_query_current_action'
          and independent['ok'] and terminal('guest-interlock')['ok'] and menu()['windowId'] == 0)
    close(True)
    # Bounded mixed-owner reads, not a load benchmark. Report measured latency.
    def read_pair(i):
        second = bool(i % 2); start = time.monotonic()
        value = tool('mod_query', {'companion': guest if second else body, 'operation': 'menu.snapshot'}, other_token) if second else tool('mod_query', {'companion': body, 'operation': 'menu.snapshot'})
        return value, (time.monotonic()-start)*1000, guest if second else body
    with ThreadPoolExecutor(max_workers=4) as pool: reads = list(pool.map(read_pair, range(12)))
    times = sorted(row[1] for row in reads)
    evidence['concurrentReadLatency'] = {'requests': 12, 'concurrency': 4, 'p50Ms': times[5], 'p95Ms': times[math.ceil(len(times)*.95)-1], 'maxMs': times[-1]}
    check('guest_concurrent_private_queries', all(row[0]['ok'] and row[0]['state']['playerUuid'] == row[2] for row in reads))
    check('guest_small_concurrency_responsive', times[-1] < 2000)
    # Ars: discover genuine registry IDs; learn one real glyph, consume one,
    # configure the actual held book, select and cast with native expenditure.
    fixture('gamerule doDaylightCycle false'); fixture('time set day')
    ground_y = math.ceil(call('get_state', {'companion': body})['position']['y'])
    fixture(f'tp MawHeadBody 20.5 {ground_y} 20.5'); fixture(f'tp MawGuestBody 40.5 {ground_y} 20.5')
    glyphs = []; offset = 0
    while True:
        page = query('spell.glyphs', {'offset': offset, 'limit': 24}); assert page['ok'], page
        glyphs.extend(page['glyphs']); offset += len(page['glyphs'])
        if not page['hasMore']: break
    self_glyph = next(g['id'] for g in glyphs if g['id'].endswith(':self') or g['id'].endswith(':glyph_self'))
    heal_glyph = next(g for g in glyphs if g['id'].endswith(':heal') or g['id'].endswith(':glyph_heal'))
    check('guest_ars_native_glyph_discovery', len(glyphs) == page['total'] and heal_glyph['enabled'])
    if not heal_glyph['known']:
        glyph_item = heal_glyph['id'] if ':glyph_' in heal_glyph['id'] else heal_glyph['id'].replace(':', ':glyph_')
        fixture('item replace entity MawHeadBody hotbar.0 with '+glyph_item+' 2')
        before = held(); learned = act('spell.learnGlyph', before, aid='guest-learn-heal')
        check('guest_ars_learn_consumes_one_real_glyph', learned['ok'] and learned['outcome']['knownAfter']
              and learned['outcome']['itemCountBefore'] == 2 and learned['outcome']['itemCountAfter'] == 1)
    else:
        raise AssertionError('Expected fresh isolated body not to know healing glyph')
    fixture('item replace entity MawHeadBody hotbar.0 with ars_nouveau:novice_spell_book 1')
    fixture('item replace entity MawGuestBody hotbar.0 with ars_nouveau:novice_spell_book 1')
    before_book = held()
    rejected = act('spell.configure', {**before_book, 'slot': 0, 'name': '访客治疗验收', 'glyphs': [self_glyph, heal_glyph['id']]})
    check('guest_ars_native_book_tier_preserved', not rejected['ok'] and rejected['outcome']['code'] == 'invalid_spell_recipe' and held() == before_book)
    fixture('item replace entity MawHeadBody hotbar.0 with ars_nouveau:apprentice_spell_book 1')
    configured = act('spell.configure', {**held(), 'slot': 0, 'name': '访客治疗验收', 'glyphs': [self_glyph, heal_glyph['id']]})
    check('guest_ars_configure_real_book', configured['ok'] and configured['outcome']['heldBefore'] != configured['outcome']['heldAfter'])
    own = query('spell.list'); other_book = query('spell.list', second=True)
    check('guest_ars_spellbook_states_isolated', any(s['name'] == '访客治疗验收' for s in own['spells']) and not other_book['spells'])
    explained = query('spell.explain', {'spellId': 'ars_nouveau:slot_0'})
    check('guest_ars_explain_real_recipe', explained['ok'] and explained['spell']['glyphs'] == [self_glyph, heal_glyph['id']])
    selected = act('spell.select', {**held(), 'slot': 0})
    check('guest_ars_select_native_slot', selected['ok'] and selected['outcome']['selectedSlotAfter'] == 0)
    before = held(); stale = act('spell.cast', {**before, 'expectedHeldSnbt': 'old-book', 'spellId': 'ars_nouveau:slot_0'})
    check('guest_ars_stale_book_cast_refused', not stale['ok'] and stale['outcome']['code'] == 'held_spellbook_changed')
    # Let genuine Ars mana regeneration supply the cost; never set a capability
    # or waive the real spell cost just to obtain a green assertion.
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        mana = query('spell.list')['state']['mana']
        if mana['current'] >= explained['spell']['manaCost'] + 5: break
        time.sleep(1)
    else: raise TimeoutError('Native mana did not regenerate enough for real heal')
    fixture('damage MawHeadBody 6 minecraft:generic')
    hp_before = call('get_state', {'companion': body})['health']
    cast_args = {**held(), 'spellId': 'ars_nouveau:slot_0'}
    cast = act('spell.cast', cast_args, aid='guest-native-heal')
    check('guest_ars_native_cast_and_real_heal', cast['ok'] and cast['outcome']['castConfirmed'] and cast['outcome']['castEvidence'] in ('native_mana_debit', 'native_expenditure_event')
          and cast['outcome']['manaSpent'] > 0 and call('get_state', {'companion': body})['health'] > hp_before)
    receipt_file = server/'world-server-numen/maw-numen-server/actions'/body/'guest-native-heal.json'
    digest = hashlib.sha256(receipt_file.read_bytes()).hexdigest()
    replay = submit('spell.cast', cast_args, 'guest-native-heal')
    check('guest_ars_cast_replay_no_second_expenditure', replay['replayed'] and replay['completedAt'] == cast['completedAt'] and hashlib.sha256(receipt_file.read_bytes()).hexdigest() == digest)
    # Maid ownership is the controlled body's UUID, not the token owner's or an
    # administrator. No AI/model loop is used for these explicit test fixtures.
    maid = str(uuid.uuid4()); foreign = str(uuid.uuid4())
    fixture('execute at MawHeadBody run summon touhou_little_maid:maid ~1 ~ ~ {UUID:'+ints(maid)+',Owner:'+ints(body)+',NoAI:1b,Invulnerable:1b,MaidAIChat:{TTSSiteName:"__none__"}}')
    fixture('execute at MawGuestBody run summon touhou_little_maid:maid ~1 ~ ~ {UUID:'+ints(foreign)+',Owner:'+ints(guest)+',NoAI:1b,Invulnerable:1b,MaidAIChat:{TTSSiteName:"__none__"}}')
    ours = query('maid.list'); theirs = query('maid.list', second=True)
    check('guest_maid_real_lists_owned_by_bodies', {m['uuid'] for m in ours['maids']} == {maid} and {m['uuid'] for m in theirs['maids']} == {foreign})
    # Move foreign body into range: ownership, rather than distance, must deny.
    fixture(f'tp MawGuestBody 20.5 {ground_y} 20.5')
    denied = query('maid.status', {'maidUuid': maid}, True)
    denied_write = act('maid.setPickup', {'maidUuid': maid, 'pickup': False}, True)
    check('guest_maid_cross_owner_read_and_write_denied', denied['code'] == 'maid_not_owned_nearby_loaded' and not denied_write['ok'] and denied_write['outcome']['code'] == 'maid_not_owned_nearby_loaded')
    detail = query('maid.status', {'maidUuid': maid}); tasks = query('maid.tasks', {'maidUuid': maid})
    check('guest_maid_native_detail_tasks', detail['ok'] and detail['maid']['ownerUuid'] == body and tasks['ok'] and any(t['enabled'] for t in tasks['tasks']))
    selected_task = next(t['id'] for t in tasks['tasks'] if t['enabled'] and t['id'] != detail['maid']['taskId'])
    task = act('maid.setTask', {'maidUuid': maid, 'taskId': selected_task})
    follow = act('maid.setFollow', {'maidUuid': maid, 'follow': False})
    pickup = act('maid.setPickup', {'maidUuid': maid, 'pickup': False})
    check('guest_maid_native_controls_verified', task['ok'] and task['outcome']['maid']['taskId'] == selected_task and follow['ok'] and follow['outcome']['maid']['sitting'] and pickup['ok'] and not pickup['outcome']['maid']['pickup'])
    # Soul slab in a fresh body's main hand would intentionally consume original
    # interactions. Empty that hand explicitly, rather than bypassing native use.
    fixture('item replace entity MawHeadBody hotbar.0 with minecraft:air')
    bag = act('maid.openBag', {'maidUuid': maid})
    check('guest_maid_real_bag_menu', bag['ok'] and menu()['windowId'] == bag['outcome']['windowId'] and menu()['windowId'] > 0)
    check('guest_maid_bag_closes_without_cursor_loss', close()['ok'] and menu()['carried'] is None)
    private_events = call('get_events', {'companion': body}, True)
    check('guest_private_event_log_denied', private_events['code'] == 'body_not_owned')
    sleeping = call('dormant_companion', {'companion': guest, 'lease_id': guest_lease}, True)
    restored = call('restore_companion', {'companion': guest, 'lease_id': guest_lease}, True)
    check('guest_restore_original_identity', not sleeping['online'] and restored['online'] and restored['bodyId'] == guest)
    call('dormant_companion', {'companion': guest, 'lease_id': guest_lease}, True)
    from maw_numen_server import revoke
    revoked = revoke(other, server.parent)
    status, refused = request('/mcp', {'jsonrpc': '2.0', 'id': 'guest-revoked', 'method': 'tools/list'}, {'Authorization': 'Bearer '+other_token})
    check('guest_operator_revoke_live_auth_only_this_owner', revoked['revoked'] and status == 401 and refused['code'] == 'invalid_bearer'
          and call('get_state', {'companion': body})['online'])
    save()
