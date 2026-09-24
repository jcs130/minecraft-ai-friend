import unittest
from unittest.mock import patch
import test_survival_gateway as fixture
import numen_gateway as gateway


class InventoryFeedbackTests(unittest.TestCase):
    setUp = fixture.GatewayTests.setUp
    write = fixture.GatewayTests.write
    lease = fixture.GatewayTests.lease

    def test_full_main_inventory_is_explicit_in_brief_observation(self):
        import mcp_server
        self.rcon.inventory = 'Kirito has the following entity data: [' + ','.join(
            '{Slot:%db,id:"minecraft:stone",count:64}' % slot for slot in range(36)) + ']'
        body = self.client.snapshot()
        self.assertEqual(body['inventorySpace']['emptyMainSlots'], 0)
        self.assertEqual(body['inventorySpace']['occupiedMainSlots'], 36)
        self.assertEqual(mcp_server.status_view(body, 'brief')['inventorySpace'], body['inventorySpace'])

    def test_missing_food_rejects_before_native_task_or_lease_use(self):
        self.lease()
        before = gateway.read_json(self.state/'lease.json')
        result = self.client.action(fixture.TURN, 'eat', {'item_id': 'minecraft:bread'})
        self.assertEqual(result['code'], 'food_item_missing')
        self.assertEqual(result['availableCount'], 0)
        self.assertFalse(result['dispatched'])
        self.assertEqual(gateway.read_json(self.state/'lease.json'), before)
        self.assertFalse(self.rcon.mutations())

    def test_owned_food_uses_normal_native_action(self):
        self.rcon.inventory = 'Kirito has the following entity data: [{Slot:0b,id:"minecraft:bread",count:2}]'
        self.lease()
        with patch('food_actions.FoodActions.dispatch', return_value={
                'success': True, 'data': {'task_id': 'food-1', 'task': 'eat', 'async': True}}) as dispatch:
            result = self.client.action(fixture.TURN, 'eat', {'item_id': 'minecraft:bread'})
            self.assertEqual(dispatch.call_count, 1)
        self.assertEqual(result['code'], 'accepted')
