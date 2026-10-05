"""The society probe reports its isolated service, never historical Docker health."""
import importlib.util
import io
import json
from pathlib import Path
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('maw_health_monitor', Path(__file__).resolve().parents[1] / 'world/ops/health/health_mon.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class SocietyHealthTests(unittest.TestCase):
    def values(self):
        # Shape recorded by native-world-preview-host's /healthz projection;
        # ordinary non-default vitals prove the probe does not assume 20 HP.
        player_uuid = '11111111-2222-3333-8444-555555555555'
        supervisor = {'healthy': True, 'heartbeatEpoch': time.time(), 'paused': False, 'services': [
            {'id': name, 'pid': index + 10, 'ready': True, 'host': '127.0.0.1', 'port': row['port']}
            for index, (name, row) in enumerate(health.SOCIETY_SERVICE_MANIFEST.items())]}
        viewer = {'ready': True, 'identity': {'player': 'OrdinaryAgent17', 'playerUuid': player_uuid}, 'agent': {'details': {
            'username': 'OrdinaryAgent17', 'online': True, 'mode': 'acting', 'native': {'failed': False, 'packets': 15}}},
            'viewer': {'entityDataAvailable': True, 'entityDataReason': None},
            'presentation': {'schemaVersion': 1, 'playerUuid': player_uuid, 'available': True,
                'source': 'same_player_connection', 'nativeState': {'available': True},
                'self': {'uuid': player_uuid, 'health': 7.5, 'maxHealth': 24},
                'inventory': {'playerUuid': player_uuid, 'windowId': 0, 'hotbarStart': 36, 'inventoryStart': 9,
                    'offhandSlot': 45, 'slots': [{'slot': slot, 'item': None} for slot in range(46)]},
                'nativeMenu': {'playerUuid': player_uuid, 'windowId': 3, 'menuType': 'farmersdelight:cooking_pot'}}}
        return supervisor, viewer

    def probe(self, values):
        with patch.object(health.urllib.request, 'urlopen', side_effect=[io.BytesIO(json.dumps(value).encode()) for value in values]) as fetch:
            result = health.probe_society_service()
        self.assertEqual([call.args[0] for call in fetch.call_args_list],
                         ['http://127.0.0.1:28985/healthz', 'http://127.0.0.1:28984/healthz'])
        return result

    def test_current_identity_and_native_stream_are_required(self):
        values = self.values()
        self.assertTrue(self.probe(values)['ok'])
        values[1]['identity']['player'] = 'AnotherPlayer'
        self.assertFalse(self.probe(values)['ok'])

    def test_stale_supervisor_or_paused_autonomy_is_not_success(self):
        values = self.values()
        values[0]['heartbeatEpoch'] -= 60
        self.assertFalse(self.probe(values)['ok'])
        values = self.values()
        values[1]['agent']['details']['mode'] = 'paused_unknown'
        self.assertFalse(self.probe(values)['ok'])

    def test_unavailable_endpoint_remains_explicitly_false(self):
        with patch.object(health.urllib.request, 'urlopen', side_effect=OSError('offline')):
            report = health.probe_society_service()
        self.assertFalse(report['ok'])
        self.assertIn('offline', report['error'])

    def test_ysm_animation_inputs_require_fresh_own_native_observations(self):
        values = self.values()
        uuid = values[1]['identity']['playerUuid']
        state = values[1]['presentation']['self']
        state['ysm'] = {'playerUuid': uuid, 'source': 'same_player_native_attachment',
                        'available': True, 'installed': True, 'enabled': True}
        state['motion'] = {'playerUuid': uuid, 'schemaVersion': 1, 'available': True,
                           'source': 'same_player_server_tick', 'sampleIntervalMs': 250,
                           'tickCount': 100, 'sampledAt': time.time() * 1000,
                           **{key: False for key in ('onGround', 'sprinting', 'flying', 'deadOrDying',
                                'swimming', 'sleeping', 'passenger', 'spinAttack')}}
        self.assertTrue(self.probe(values)['checks']['same-player-ysm-animation-inputs'])
        for key, invalid in (('playerUuid', 'aaaaaaaa-bbbb-3ccc-8ddd-eeeeeeeeeeee'),
                             ('sampledAt', (time.time() - 10) * 1000), ('available', False),
                             ('onGround', None), ('sprinting', 1), ('source', 'client_guessed')):
            previous = state['motion'][key]
            state['motion'][key] = invalid
            self.assertFalse(self.probe(values)['checks']['same-player-ysm-animation-inputs'], key)
            state['motion'][key] = previous

    def test_missing_ysm_inputs_and_foreign_appearance_cannot_be_green(self):
        values = self.values()
        state = values[1]['presentation']['self']
        state['ysm'] = {'playerUuid': 'aaaaaaaa-bbbb-3ccc-8ddd-eeeeeeeeeeee',
                        'source': 'same_player_native_attachment', 'available': True,
                        'installed': True, 'enabled': True}
        report = self.probe(values)
        self.assertFalse(report['checks']['same-player-ysm-state'])
        self.assertFalse(report['checks']['same-player-ysm-animation-inputs'])

    def test_native_entity_stream_unknown_reason_or_unavailable_cannot_be_green(self):
        for available, reason, present in ((False, None, True), (True, 'NATIVE_ENTITY_REGISTRY_UNAVAILABLE', True),
                                          (True, None, False), (None, None, True), (1, None, True)):
            with self.subTest(available=available, reason=reason, present=present):
                values = self.values()
                values[1]['viewer'] = {'entityDataAvailable': available}
                if present:
                    values[1]['viewer']['entityDataReason'] = reason
                report = self.probe(values)
                self.assertFalse(report['ok'])
                self.assertFalse(report['checks']['native-entity-stream'])

    def test_same_player_bindings_are_required_without_a_fixed_account_name(self):
        foreign_uuid = 'aaaaaaaa-bbbb-3ccc-8ddd-eeeeeeeeeeee'
        for node, key in (('presentation', 'playerUuid'), ('self', 'uuid'), ('inventory', 'playerUuid')):
            with self.subTest(node=node):
                values = self.values()
                target = values[1]['presentation'] if node == 'presentation' else values[1]['presentation'][node]
                target[key] = foreign_uuid
                report = self.probe(values)
                self.assertFalse(report['ok'])
                self.assertFalse(report['checks']['same-player-native-presentation'])
        values = self.values()
        for node in (values[1]['identity'], values[1]['presentation'], values[1]['presentation']['self'], values[1]['presentation']['inventory']):
            for key in ('playerUuid', 'uuid'):
                if key in node:
                    node[key] = 'not-a-real-uuid'
        self.assertFalse(self.probe(values)['checks']['same-player-native-presentation'])

    def test_external_menu_still_requires_canonical_46_player_inventory_rows(self):
        values = self.values()
        values[1]['presentation']['inventory']['slots'][12]['item'] = {
            'name': 'farmersdelight:tree_bark', 'count': 2, 'snbt': '{id:"farmersdelight:tree_bark",count:2}'}
        report = self.probe(values)
        self.assertTrue(report['ok'])
        self.assertEqual(len(report['checks']), 10)
        for invalid in ('short', 'duplicate', 'missing_item', 'false_slot', 'proxy_count'):
            with self.subTest(invalid=invalid):
                values = self.values()
                inventory = values[1]['presentation']['inventory']
                if invalid == 'short':
                    inventory['slots'].pop()
                elif invalid == 'duplicate':
                    inventory['slots'][45]['slot'] = 44
                elif invalid == 'missing_item':
                    del inventory['slots'][5]['item']
                elif invalid == 'false_slot':
                    inventory['slots'][0]['slot'] = False
                else:
                    inventory['slots'][12]['item'] = {'name': 'minecraft:paper', 'count': True, 'snbt': '{}'}
                self.assertFalse(self.probe(values)['checks']['same-player-native-presentation'])

    def test_vitals_must_be_real_finite_numbers_with_a_known_reasonable_upper_limit(self):
        for hp, max_hp in ((20, None), (None, 24), ('7.5', 24), (True, 24), (7.5, float('nan')),
                           (float('inf'), 24), (-1, 24), (25, 24), (0, 0), (7.5, 1025), (10**400, 24)):
            with self.subTest(hp=hp, max_hp=max_hp):
                values = self.values()
                values[1]['presentation']['self'].update(health=hp, maxHealth=max_hp)
                report = self.probe(values)
                self.assertFalse(report['ok'])
                self.assertFalse(report['checks']['same-player-native-presentation'])

    def test_presentation_ready_requires_native_injection_and_the_same_connection_source(self):
        for change in ({'available': False}, {'schemaVersion': True}, {'nativeState': {'available': False}}, {'source': 'proxy_inventory'},
                       {'inventory': None}, {'self': None}):
            with self.subTest(change=change):
                values = self.values()
                values[1]['presentation'].update(change)
                self.assertFalse(self.probe(values)['checks']['same-player-native-presentation'])


if __name__ == '__main__':
    unittest.main()
