"""Fresh status projections with isolated receipts; no game, service or model I/O."""
import asyncio
import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
import mcp_server
import numen_gateway
import test_survival_gateway as fixture


class StatusProjectionTests(unittest.TestCase):
    def test_brief_only_omits_slots_and_explicitly_marks_the_omission(self):
        body = {'ok': True, 'inventory': [{'slot': 0, 'id': 'minecraft:stick', 'count': 2}],
                'counts': {'minecraft:stick': 2}, 'equipment': {'mainhand': 'minecraft:stick'},
                'inventorySpace': {'mainSlots': 36, 'occupiedSlots': 1, 'freeSlots': 35},
                'ownedSkillBooks': [{'name': 'fixture'}], 'air': 2, 'inWater': True,
                'inLava': False, 'hp': 5, 'bodyControl': {'kind': 'reflex'},
                'navigationEpoch': 'epoch', 'navigationResult': {'state': 'failed'},
                'actionExecution': {'ok': False, 'inFlight': True, 'code': 'outcome_unknown'},
                'futureSafetyField': {'mustPreserve': True}}
        original = copy.deepcopy(body)
        self.assertEqual(mcp_server.status_view(body), original)
        projected = mcp_server.status_view(body, 'brief')
        self.assertEqual(projected.pop('statusDetail'), 'brief')
        self.assertEqual(projected.pop('omittedFields'), ['inventory'])
        self.assertEqual(projected, {k: v for k, v in original.items() if k != 'inventory'})
        self.assertEqual(body, original)

    def test_bad_detail_has_no_io_and_failed_observation_does_not_invent_inventory(self):
        class Gateway:
            calls = 0

            def snapshot(self):
                self.calls += 1
                return {'ok': False, 'online': None, 'code': 'observation_unavailable'}

            def action_status(self, body):
                return {'ok': False, 'inFlight': True, 'code': 'outcome_unknown'}

        gateway = Gateway()
        for value in ('', 'delta', None, True, [], {}):
            self.assertEqual(mcp_server.read_status(gateway, detail=value),
                             {'ok': False, 'code': 'invalid_status_detail'})
        self.assertEqual(gateway.calls, 0)
        result = mcp_server.read_status(gateway, 10, detail='brief',
                                      sleep=lambda _: self.fail('unknown must not busy poll'))
        self.assertEqual(gateway.calls, 1)
        self.assertIsNone(result['online'])
        self.assertNotIn('inventory', result)
        self.assertNotIn('counts', result)
        self.assertEqual(result['actionExecution']['code'], 'outcome_unknown')

    def test_bounded_wait_settles_with_full_fresh_samples_then_projects_terminal(self):
        class Gateway:
            now = 0
            samples = 0

            def snapshot(self):
                self.samples += 1
                return {'ok': True, 'observedAt': self.now, 'inventory': [{'count': self.samples}],
                        'counts': {'minecraft:stick': self.samples}, 'task': {'busy': self.now < 2}}

            def action_status(self, body):
                # A projection must never reach settlement or hide a changed inventory.
                self_inventory = body['inventory'][0]['count']
                return {'ok': True, 'inFlight': self.now < 2,
                        'receipt': {'actionId': 'fixture-action', 'turnId': 'private-capability',
                                    'status': 'completed' if self.now >= 2 else 'in_flight',
                                    'completionConfirmed': self.now >= 2}, 'sample': self_inventory}

            def sleep(self, seconds):
                self.now += seconds

        gateway = Gateway()
        result = mcp_server.read_status(gateway, 10, detail='brief',
                                       monotonic=lambda: gateway.now, sleep=gateway.sleep)
        self.assertEqual(gateway.now, 2)
        self.assertEqual(gateway.samples, 2)
        self.assertEqual(result['counts'], {'minecraft:stick': 2})
        self.assertEqual(result['actionExecution']['sample'], 2)
        self.assertEqual(result['actionExecution']['receipt']['status'], 'completed')
        self.assertNotIn('turnId', result['actionExecution']['receipt'])
        self.assertNotIn('inventory', result)
        next_result = mcp_server.read_status(gateway, detail='brief')
        self.assertEqual(next_result['counts'], {'minecraft:stick': 3})
        self.assertEqual(gateway.samples, 3)


class StatusGatewayTests(unittest.TestCase):
    setUp = fixture.GatewayTests.setUp
    write = fixture.GatewayTests.write

    def open_lease(self):
        self.client.open_lease(fixture.TURN, fixture.NOW * 1000 + 120000, action_limit=6)

    def test_brief_navigation_terminal_does_not_consume_or_extend_lease(self):
        self.open_lease()
        first = self.client.action(fixture.TURN, 'goto', {'x': 110, 'y': 64, 'z': 100})
        self.assertEqual(first['code'], 'accepted')
        lease_before = numen_gateway.read_json(self.state / 'lease.json')
        self.rcon.navigation_result = {'task_id': 't1', 'navigation_epoch': self.rcon.navigation_epoch,
                                       'state': 'failed', 'success': False}
        brief = mcp_server.read_status(self.client, detail='brief')
        full = mcp_server.read_status(self.client)
        self.assertEqual(brief, mcp_server.status_view(full, 'brief'))
        receipt = brief['actionExecution']['receipt']
        self.assertEqual(receipt['status'], 'failed')
        self.assertTrue(receipt['completionConfirmed'])
        self.assertEqual(receipt['actionId'], first['actionId'])
        self.assertNotIn('turnId', receipt)
        self.assertEqual(numen_gateway.read_json(self.state / 'lease.json'), lease_before)
        self.assertEqual(len(self.rcon.mutations()), 1)

    def test_brief_unknown_receipt_keeps_no_replay_barrier_and_closed_lease(self):
        self.open_lease()
        self.rcon.reply = TimeoutError()
        first = self.client.action(fixture.TURN, 'craft', {'item_id': 'minecraft:stick', 'count': 1})
        self.assertEqual(first['code'], 'outcome_unknown')
        lease_before = (self.state / 'lease.json').read_bytes()
        unknown_before = (self.state / 'unknown.json').read_bytes()
        for detail in ('brief', 'full', 'brief'):
            result = mcp_server.read_status(self.client, 10, detail=detail,
                                           sleep=lambda _: self.fail('unknown must not poll'))
            self.assertEqual(result['actionExecution']['code'], 'outcome_unknown')
            self.assertEqual(result['actionExecution']['receipt']['status'], 'unknown')
            self.assertFalse(result['actionExecution']['receipt']['completionConfirmed'])
        self.assertEqual((self.state / 'unknown.json').read_bytes(), unknown_before)
        self.assertEqual((self.state / 'lease.json').read_bytes(), lease_before)
        self.assertFalse(self.client.action(fixture.TURN, 'craft',
                                           {'item_id': 'minecraft:stick', 'count': 1})['ok'])
        self.assertEqual(len(self.rcon.mutations()), 1)

    def test_brief_query_refreshes_craft_counts_and_full_restores_slot_metadata(self):
        self.open_lease()
        self.rcon.reply = {'success': True}
        self.client.action(fixture.TURN, 'craft', {'item_id': 'minecraft:stick', 'count': 1})
        before = mcp_server.read_status(self.client, detail='brief')
        self.rcon.inventory = 'Kirito has the following entity data: [{Slot:2b,id:"minecraft:stick",count:4}]'
        after = mcp_server.read_status(self.client, detail='brief')
        full = mcp_server.read_status(self.client)
        self.assertNotIn('minecraft:stick', before['counts'])
        self.assertEqual(after['counts']['minecraft:stick'], 4)
        self.assertEqual(after['actionExecution']['receipt']['status'], 'completed')
        self.assertIn('inventory', full)
        self.assertNotIn('statusDetail', full)
        self.assertNotIn('omittedFields', full)
        self.assertEqual(after, mcp_server.status_view(full, 'brief'))
        self.assertEqual(len(self.rcon.mutations()), 1)

    def test_mcp_schema_defaults_to_brief_and_explicit_full_retains_every_field(self):
        async def check():
            server = mcp_server.make_server(self.client)
            listed = await server.list_tools()
            from native_tools import valid_tools
            self.assertTrue(valid_tools([{'name': t.name, 'enabled': True, 'input_schema': t.inputSchema}
                                         for t in listed]))
            tool = next(t for t in listed if t.name == 'status')
            self.assertEqual(tool.inputSchema['properties']['detail']['default'], 'brief')
            self.assertEqual(set(tool.inputSchema['properties']['detail']['enum']), {'full', 'brief'})
            self.assertNotIn('detail', tool.inputSchema.get('required', []))
            default_result = await server.call_tool('status', {})
            full_result = await server.call_tool('status', {'detail': 'full'})
            brief_result = await server.call_tool('status', {'detail': 'brief'})
            # Newer FastMCP also returns structured content beside the blocks.
            def decoded(result):
                blocks = result[0] if isinstance(result, tuple) else result
                return json.loads(blocks[0].text)
            full = decoded(full_result)
            brief = decoded(brief_result)
            default = decoded(default_result)
            self.assertIn('inventory', full)
            self.assertEqual(default, brief)
            self.assertNotIn('inventory', default)
            for key in ('counts', 'inventorySpace', 'equipment', 'hp', 'air', 'inWater', 'inLava',
                        'bodyControl', 'actionExecution'):
                self.assertIn(key, default)
                self.assertEqual(default[key], brief[key])
            self.assertEqual(brief, mcp_server.status_view(full, 'brief'))
            self.assertEqual(mcp_server.read_status(self.client), full)
        asyncio.run(check())
        self.assertFalse(self.rcon.mutations())


if __name__ == '__main__':
    unittest.main()
