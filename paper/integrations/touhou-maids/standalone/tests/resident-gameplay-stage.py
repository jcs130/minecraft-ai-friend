"""Real guild, wallet and native-inventory regression on a fresh marked Youer fixture.

Requires RecruitmentProbe, two configured synthetic residents and the fixture
task-market.yml below. No connection, OP grant, unknown-request reset, invented
receipt or production deployment is performed. Restart checks are a separate
invocation of --verify-restart against the saved report and the SAME world.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import time
import uuid

TASK_MARKET = """schema-version: 1
sites: {}
tasks:
  resident_delivery:
    scope: personal
    repeat: once
    title: 隔离居民物资交付
    description: 交付本人原生背包的八朵罂粟。
    icon: POPPY
    reward: {fame: 6, emeralds: 2, bonus: BREAD, bonus-count: 2}
    steps:
      - {title: 交付原物, description: 交付八朵罂粟。, goal: donate, item: POPPY, target: 8}
"""


class Exercise:
    def __init__(self, stage, report):
        self.stage = stage.resolve()
        if (self.stage / '.resident-hybrid-qa').read_text().strip() != 'SYNTHETIC_RESIDENT_HYBRID_ONLY':
            raise ValueError('synthetic marker required')
        props = dict(line.split('=', 1) for line in (self.stage / 'server.properties').read_text().splitlines() if '=' in line)
        if props['server-ip'] != '127.0.0.1' or props['rcon.port'] == '25575':
            raise ValueError('isolated loopback fixture required')
        spec = importlib.util.spec_from_file_location('stock', Path(__file__).with_name('stock-stage.py'))
        self.stock = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.stock)
        self.port, self.password = int(props['rcon.port']), props['rcon.password']
        self.report = report
        self.evidence = {'stage': str(self.stage), 'productionChanged': False, 'checks': [], 'receipts': []}

    def save(self):
        self.report.parent.mkdir(parents=True, exist_ok=True)
        self.report.write_text(json.dumps(self.evidence, ensure_ascii=False, indent=2), encoding='utf8')

    def cmd(self, text):
        return self.stock.rcon(self.port, self.password, text)

    def resident(self, command):
        raw = self.cmd('maidagent ' + command)
        if not raw.startswith('MC_RESIDENT '):
            raise AssertionError('Expected resident receipt: ' + raw)
        return json.loads(raw.removeprefix('MC_RESIDENT '))

    def check(self, name, condition):
        if not condition:
            self.evidence['failure'] = name
            self.save()
            raise AssertionError(name)
        self.evidence['checks'].append(name)
        print(name, flush=True)

    def items(self, actor):
        return json.loads(self.cmd('companiontest inventory ' + actor))['items']

    def service(self, actor, command=None, request=None):
        request = request or str(uuid.uuid4())
        prefix = 'companiontest service ' + actor + ' ' + request
        value = json.loads(self.cmd(prefix + (' ' + command if command else '')))
        if value.get('status') == 'accepted':
            # A timeout stops this exercise. Only the original ID is queried; no write replay.
            value = self.stock.until(lambda: (row if (row := json.loads(self.cmd(prefix))).get('status') != 'accepted' else None), 30)
        self.evidence['receipts'].append(value)
        self.save()
        if value.get('status') == 'unknown':
            raise AssertionError('unknown action retained; inspect original request ' + request)
        return value

    def run(self, actor, peer):
        self.evidence.update(actor=actor, peer=peer)
        row = self.service(actor, 'status')
        self.check('status_is_actual_native_body', row['status'] == 'completed' and row['serviceReceipt']['maidId'] == actor and row['serviceReceipt']['usesPlayerSlot'] is False)
        row = self.service(actor, 'land here')
        self.check('native_land_query_available', row['status'] == 'completed' and bool(row['serviceReceipts']))
        row = self.service(actor, 'land trust no_such_land ' + peer)
        self.check('invalid_land_does_not_grant_permission', row['status'] == 'blocked' and row['serviceReceipt']['changed'] is False)
        row = self.service(actor, 'guild join')
        self.check('join_own_uuid', row['status'] == 'completed' and row['serviceReceipt']['actorId'] == actor)
        row = self.service(actor, 'guild verify')
        self.check('verification_without_task_is_not_success',row['status']=='blocked' and not row['serviceReceipt']['success'])
        row = self.service(peer, 'guild status')
        self.check('peer_membership_isolated', not row['serviceReceipt']['after']['joined'])
        row = self.service(actor, 'guild accept no_such_quest')
        self.check('invalid_quest_not_completed', row['status'] == 'blocked' and not row['serviceReceipt']['goalCompleted'])
        self.check('invalid_quest_has_actionable_reason', row['reason'] == 'task_not_found' and row['serviceReceipt']['nextSafeRead'] == 'guild board')
        self.check('human_receipt_has_no_colour_codes', all('\u00a7' not in text for text in row['messages']))
        row = self.service(actor, 'guild board')['serviceReceipt']
        self.check('bounded_structured_guild_catalogue', row['returnedCount'] == len(row['items']) <= row['pageSize'] == 12 and row['autoContinue'] is False)
        daily = next(x for x in row['items'] if x['id'].startswith('db_'))
        self.check('daily_id_not_contaminated_by_colour', daily['acceptCommand'] == 'guild accept ' + daily['id'] and not daily['id'].startswith('edb_'))
        self.check('catalogue_coverage_consistent', row['remaining'] == row['total'] - row['returnedCount'])
        if row['remaining']:
            following = self.service(actor, row['nextCommand'])['serviceReceipt']
            self.check('catalogue_continuation_not_repeated', following['page'] == 2 and not set(x['id'] for x in row['items']) & set(x['id'] for x in following['items']))
        accepted = self.service(actor, daily['acceptCommand'])
        self.check('daily_catalogue_and_accept_agree', (accepted['status'] == 'completed') == daily['canAccept'])
        if daily['canAccept']:
            self.service(actor, 'guild abandon')
        row = self.service(actor, 'tasks list supply')
        self.check('actual_task_discoverable', any(x['id'] == 'tm_resident_delivery' for x in row['serviceReceipt']['items']))
        row = self.service(actor, 'guild accept tm_resident_delivery')
        self.check('task_accepted', row['status'] == 'completed')
        row = self.service(actor, 'guild verify')
        self.check('unfulfilled_verification_is_not_success',row['status']=='blocked' and not row['serviceReceipt']['goalCompleted'])
        row = self.service(actor, 'guild claim')
        self.check('missing_material_not_rewarded', row['status'] == 'blocked' and row['serviceReceipt']['fame'] == 0)
        row = self.service(actor, 'guild claim')
        self.check('throttle_is_terminal', row['status'] == 'blocked')
        self.check('throttle_diagnostic_is_not_overwritten',row['reason']=='verification_throttled' and row['retryable'] and 0<row['retryAfterMs']<=1000)
        time.sleep(1.1)
        self.cmd(f'companiontest item-fixture {actor} 4 minecraft:poppy 10')
        row = self.service(actor, 'guild claim')
        self.check('actual_task_completed', row['status'] == 'completed' and row['serviceReceipt']['goalCompleted'] and row['serviceReceipt']['fame'] == 6)
        self.check('exact_donation_consumed', next(x['count'] for x in self.items(actor) if x['slot'] == 4) == 2)
        row = self.service(actor, 'arena recycle quote bag 1 1')
        self.check('unequipped_sword_quoted', row['status'] == 'completed')
        self.check('quote_confirm_command_is_supported', row['serviceReceipt']['confirmCommand']=='arena recycle sell '+row['serviceReceipt']['quoteId'])
        sold = self.service(actor, 'arena recycle sell ' + row['serviceReceipt']['quoteId'])
        self.evidence['sale'] = sold
        self.check('sale_completed', sold['status'] == 'completed')
        self.check('sold_item_really_removed', not any(x['id'] == 'minecraft:iron_sword' for x in self.items(actor)))
        self.check('sale_idempotent', self.service(actor, sold['command'], sold['requestId']) == sold)
        own = self.service(actor, 'arena wallet')['serviceReceipt']['balance']
        other = self.service(peer, 'arena wallet')['serviceReceipt']['balance']
        self.check('separate_real_wallets', own > 0 and other == 0)
        equipped = json.loads(self.cmd('companiontest body ' + actor))['mainhand']
        row = self.service(actor, 'arena recycle quote bag 999 1')
        self.check('invalid_slot_refused', row['status'] == 'blocked')
        self.check('equipped_tool_not_sold', json.loads(self.cmd('companiontest body ' + actor))['mainhand'] == equipped)
        row = self.service(actor, 'arena shop list')
        summary=row['serviceReceipt'];offers=[x for x in row['serviceReceipts'] if x['action']=='shop_list']
        self.check('bounded_shop_rows', row['status']=='completed' and len(offers)==summary['returnedCount']<=8 and row['responseComplete'] and summary['autoContinue'] is False)
        following=self.service(actor,summary['nextCommand'])
        self.check('shop_continuation_without_overlap', not set(x['offerId'] for x in offers)&set(x['offerId'] for x in following['serviceReceipts'] if x['action']=='shop_list'))
        row=self.service(actor,'arena shop list food')
        self.check('food_query_actual_offer_and_supported_command', any(x.get('offerId')=='food' and x['buyCommand']=='arena shop buy food' and x['unitPrice']<=x['balance'] for x in row['serviceReceipts']))
        row = self.service(actor, 'arena shop buy food')
        self.check('purchase_quantity_actual', row['status'] == 'completed' and row['serviceReceipt']['quantity'] == 8)
        self.check('purchase_reports_queued_delivery', row['serviceReceipt']['reason']=='queued_for_personal_chest' and row['serviceReceipt']['paymentPending'] is False and row['serviceReceipt']['pending'] is True and row['serviceReceipt']['nextAction']=='arena stash collect')
        empty = self.service(actor, 'arena stash list 1')['serviceReceipt']
        self.check('empty_stash_with_queue_explains_next_step', not empty['items'] and empty['queuedEntries']>0 and empty['nextAction']=='arena stash collect')
        row = self.service(actor, 'arena stash collect')
        self.check('queue_materialized', row['status'] == 'completed' and row['serviceReceipt']['queuedRemaining'] == 0)
        self.check('collection_not_confused_with_bag_delivery', row['serviceReceipt']['transferredToInventory'] is False and row['serviceReceipt']['nextSafeRead']=='arena stash list 1' and 'goalCompleted' not in row['serviceReceipt'])
        row = self.service(actor, 'arena stash list 1')
        food = next(x for x in row['serviceReceipt']['items'] if x['baseId'] == 'minecraft:cooked_beef')
        self.check('stash_has_purchased_food', food['count'] == 8)
        row = self.service(actor, f'arena stash take {food["slot"]} 6')
        self.check('six_items_taken', row['status'] == 'completed' and row['serviceReceipt']['moved'] == 6)
        item = next(x for x in self.items(actor) if x['id'] == 'minecraft:cooked_beef')
        self.check('six_items_in_real_bag', item['count'] == 6)
        put = self.service(actor, f'arena stash putslot {item["slot"]} 3')
        self.check('three_items_returned', put['status'] == 'completed' and put['serviceReceipt']['moved'] == 3)
        self.check('transfer_idempotent', self.service(actor, put['command'], put['requestId']) == put)
        self.check('real_remainder_conserved', next(x['count'] for x in self.items(actor) if x['id'] == 'minecraft:cooked_beef') == 3)
        self.cmd('companiontest notice ' + actor + ' Later private trial notification')
        self.check('late_notice_cannot_rewrite_sale', self.service(actor, None, sold['requestId']) == sold)
        self.check('no_player_connection_slots', json.loads(self.cmd('companiontest player-count'))['onlinePlayers'] == 0)
        self.evidence['passed'] = True
        self.save()

    def restart(self, prior):
        previous = json.loads(prior.read_bytes())
        if Path(previous['stage']).resolve() != self.stage or not previous['passed']:
            raise ValueError('successful same-world pre-restart evidence required')
        actor, sale = previous['actor'], previous['sale']
        self.check('original_sale_after_restart', self.service(actor, None, sale['requestId']) == sale)
        self.check('sold_item_still_absent', not any(x['id'] == 'minecraft:iron_sword' for x in self.items(actor)))
        self.evidence['passed'] = True
        self.save()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--stage', type=Path, required=True)
    p.add_argument('--report', type=Path, required=True)
    p.add_argument('--resident')
    p.add_argument('--peer')
    p.add_argument('--verify-restart', type=Path)
    args = p.parse_args()
    test = Exercise(args.stage, args.report)
    if args.verify_restart:
        if args.report.resolve() == args.verify_restart.resolve():
            p.error('keep the original report; restart report must be separate')
        test.restart(args.verify_restart)
    else:
        if not args.resident or not args.peer:
            p.error('--resident and --peer required for fresh exercise')
        actor, peer = str(uuid.UUID(args.resident)), str(uuid.UUID(args.peer))
        if actor == peer:
            p.error('distinct synthetic identities required')
        test.run(actor, peer)


if __name__ == '__main__':
    main()
