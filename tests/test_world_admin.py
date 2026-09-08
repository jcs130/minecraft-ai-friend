"""Real queue/consumer integration with a deterministic Minecraft protocol fixture.

No game server or model is contacted. Socket tests exercise the actual transport.
"""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import struct
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'world/ops'), str(ROOT / 'world/sidecar')]
from world_admin_tools import ADMIN_ACTOR, AdminStore, RULES, TIMES, TOOL_NAMES, WorldAdminTools, register_admin_tools
from world_admin_consumer import NativeAdminRcon, WorldAdminConsumer, clean, rule_value, time_value


class Minecraft:
    def __init__(self):
        self.rules = {rule: True for rule in RULES}
        self.daytime = 3500
        self.weather = 'rain'
        self.calls = []
        self.before_write = lambda: None
        self.fail = None

    def __call__(self, command):
        self.calls.append(command)
        if command == self.fail:
            raise TimeoutError('fixture')
        if command == 'list':
            return 'There are 2 of a max of 20 players online: Goddess, Kirito'
        if command == 'time query daytime':
            return 'The time is ' + str(self.daytime)
        if command.startswith('gamerule '):
            words = command.split()
            rule = words[1]
            if len(words) == 3:
                self.before_write()
                self.rules[rule] = words[2] == 'true'
                return 'Gamerule %s is now set to: %s' % (rule, words[2])
            return 'Gamerule %s is currently set to: %s' % (rule, str(self.rules[rule]).lower())
        if command.startswith('time set '):
            self.before_write()
            self.daytime = TIMES[command.split()[2]]
            return 'Set the time to ' + str(self.daytime)
        if command.startswith('weather '):
            self.before_write()
            self.weather = command.split()[1]
            return 'Set the weather to ' + ('rain & thunder' if self.weather == 'thunder' else self.weather)
        raise AssertionError(command)


class AdminIntegrationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.now = [1800000000.0]
        self.clock = lambda: self.now[0]
        self.tools = WorldAdminTools(ADMIN_ACTOR, self.root, self.clock)
        self.game = Minecraft()
        self.consumer = WorldAdminConsumer(self.root, self.game, self.clock)

    def submit(self, operation='rule', args=None, request='request-0001'):
        return self.tools.submit(request, operation, args or {'rule': 'keepInventory', 'value': True})

    def test_real_claim_and_before_are_durable_before_mutation_then_readback(self):
        self.game.rules['keepInventory'] = False
        queued = self.submit()
        self.assertTrue(queued['ok'])
        self.assertEqual(queued['status'], 'queued')
        self.assertFalse(queued['executionConfirmed'])
        self.assertEqual(self.game.calls, [])
        seen = []
        self.game.before_write = lambda: seen.append(AdminStore(self.root).receipt(ADMIN_ACTOR, 'request-0001'))
        health = self.consumer.tick()
        result = self.tools.receipt('request-0001')
        self.assertEqual(seen[0]['status'], 'unknown')
        self.assertFalse(seen[0]['before']['value'])
        self.assertTrue(result['after']['value'])
        self.assertTrue(result['executionConfirmed'])
        self.assertEqual(result['nativeReceipt'], 'Gamerule keepInventory is now set to: true')
        self.assertEqual(health['completed'], 1)
        self.assertEqual(json.loads((self.root/'admin/consumer.json').read_text())['protocol'], 1)

    def test_ids_dedupe_across_restart_and_input_conflicts_fail(self):
        self.submit()
        self.consumer.tick()
        calls = list(self.game.calls)
        tools = WorldAdminTools(ADMIN_ACTOR, self.root, self.clock)
        result = tools.submit('request-0001', 'rule', {'rule': 'keepInventory', 'value': True})
        self.assertTrue(result['replayedReceipt'])
        WorldAdminConsumer(self.root, self.game, self.clock).tick()
        self.assertEqual(calls, self.game.calls)
        with self.assertRaisesRegex(ValueError, 'conflict'):
            tools.submit('request-0001', 'time', {'time': 'night'})

    def test_non_admin_cannot_mutate_or_read_another_actor_receipt(self):
        self.submit()
        self.consumer.tick()
        other = WorldAdminTools('operations:mc-god', self.root, self.clock)
        self.assertEqual(other.submit('other-request', 'rule', {'rule': 'keepInventory', 'value': True})['code'], 'admin_actor_required')
        self.assertEqual(other.receipt('request-0001')['code'], 'request_not_found')
        self.assertEqual(other.submit('other-observe', 'diagnostics', {})['status'], 'queued')

    def test_invalid_or_destructive_arguments_never_reach_queue(self):
        cases = [('rule', {'rule': 'keepInventory', 'value': False}),
                 ('rule', {'rule': 'keep_inventory', 'value': True}),
                 ('rule', {'rule': 'doFireTick', 'value': 'true'}),
                 ('rule', {'rule': 'doFireTick', 'value': True, 'actor': ADMIN_ACTOR}),
                 ('time', {'time': 'day\nstop'}), ('time', {'time': 1000}),
                 ('weather', {'weather': 'clear', 'durationSeconds': 601}),
                 ('weather', {'weather': 'clear', 'durationSeconds': True}),
                 ('weather', {'weather': 'clear', 'durationSeconds': float('nan')}),
                 ('raw', {'command': 'op Kirito'}), ('tp', {'target': 'Kirito'}),
                 ('diagnostics', {'command': 'stop'})]
        for operation, args in cases:
            with self.subTest(operation=operation, args=args), self.assertRaises(ValueError):
                self.tools.submit('request-invalid', operation, args)
        self.consumer.tick()
        self.assertEqual(self.game.calls, [])

    def test_unavailable_precondition_rejects_without_world_write(self):
        self.submit()
        self.game.fail = 'gamerule keepInventory'
        self.consumer.tick()
        result = self.tools.receipt('request-0001')
        self.assertEqual(result['status'], 'rejected')
        self.assertEqual(result['code'], 'precondition_unavailable')
        self.assertEqual(self.game.calls, ['gamerule keepInventory'])

    def test_lost_mutation_reply_blocks_new_write_not_diagnostics_never_replays(self):
        self.submit()
        native = self.game
        def drop(command):
            value = native(command)
            if command == 'gamerule keepInventory true':
                raise TimeoutError('reply lost after actual apply')
            return value
        self.consumer.run = drop
        self.consumer.tick()
        self.assertEqual(self.tools.receipt('request-0001')['status'], 'unknown')
        self.submit('time', {'time': 'night'}, 'request-0002')
        self.tools.submit('request-0003', 'diagnostics', {})
        restarted = WorldAdminConsumer(self.root, native, self.clock)
        restarted.tick()
        self.assertEqual(self.tools.receipt('request-0003')['code'], 'observed')
        restarted.tick()
        self.assertEqual(self.tools.receipt('request-0002')['status'], 'queued')
        self.assertEqual(native.calls.count('gamerule keepInventory true'), 1)
        self.assertFalse(any(c.startswith('time set') for c in native.calls))

    def test_crash_claim_survives_restart_and_has_no_inferred_failure_or_retry(self):
        self.submit()
        self.assertIsNotNone(self.consumer.store.claim())
        resumed = WorldAdminConsumer(self.root, self.game, self.clock)
        resumed.tick()
        self.assertEqual(self.tools.receipt('request-0001')['status'], 'unknown')
        self.assertEqual(self.game.calls, [])

    def test_command_ack_without_correct_postcondition_is_unknown(self):
        self.submit()
        reads = [0]
        def changed(command):
            raw = self.game(command)
            if command == 'gamerule keepInventory':
                reads[0] += 1
                if reads[0] == 2:
                    return 'Gamerule keepInventory is currently set to: false'
            return raw
        self.consumer.run = changed
        self.consumer.tick()
        self.assertEqual(self.tools.receipt('request-0001')['status'], 'unknown')

    def test_diagnostics_are_real_reads_and_explicitly_no_weather_guess(self):
        self.tools.submit('diagnose-0001', 'diagnostics', {})
        self.consumer.tick()
        result = self.tools.receipt('diagnose-0001')
        self.assertEqual(result['observation']['players'], ['Goddess', 'Kirito'])
        self.assertEqual(result['observation']['playerCount'], 2)
        self.assertEqual(result['observation']['gamerules']['keepInventory'], True)
        self.assertIsNone(result['observation']['weather'])
        self.assertFalse(result['executionConfirmed'])
        self.assertTrue(all(NativeAdminRcon.allowed(c) and not c.startswith(('time set', 'weather ')) for c in self.game.calls))

    def test_weather_uses_explicit_seconds_and_native_ack_not_faked_independent_observation(self):
        self.submit('weather', {'weather': 'thunder', 'durationSeconds': 30})
        self.consumer.tick()
        result = self.tools.receipt('request-0001')
        self.assertIn('weather thunder 30s', self.game.calls)
        self.assertTrue(result['executionConfirmed'])
        self.assertFalse(result['after']['weatherObserved'])
        self.assertIsNone(result['after']['currentWeather'])
        self.assertEqual(result['nativeReceipt'], 'Set the weather to rain & thunder')

    def test_time_uses_real_postcondition_and_rejects_unrelated_time_reply(self):
        self.submit('time', {'time': 'noon'})
        self.consumer.tick()
        self.assertEqual(self.tools.receipt('request-0001')['after']['daytime'], 6000)
        self.submit('time', {'time': 'midnight'}, 'request-0002')
        def wrong(command):
            value = self.game(command)
            return 'The time is 1000' if command == 'time query daytime' else value
        self.consumer.run = wrong
        self.consumer.tick()
        self.assertEqual(self.tools.receipt('request-0002')['status'], 'unknown')

    def test_expiry_and_read_receipts_never_consume_or_execute(self):
        self.submit()
        self.tools.receipt('request-0001')
        self.assertEqual(self.game.calls, [])
        self.now[0] += 121
        self.consumer.tick()
        self.assertEqual(self.tools.receipt('request-0001')['status'], 'expired')
        self.assertEqual(self.game.calls, [])

    def test_concurrent_same_id_and_consumers_execute_only_once(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: self.submit(), range(8)))
        started, release = threading.Event(), threading.Event()
        def wait():
            started.set()
            self.assertTrue(release.wait(3))
        self.game.before_write = wait
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(self.consumer.tick)
            self.assertTrue(started.wait(3))
            self.submit('time', {'time': 'night'}, 'request-0002')
            second = WorldAdminConsumer(self.root, self.game, self.clock)
            second.tick()
            self.assertEqual(self.game.calls.count('gamerule keepInventory true'), 1)
            self.assertNotIn('time set night', self.game.calls)
            release.set()
            first.result(3)

    def test_consumer_revalidates_forged_persisted_actor_and_arguments(self):
        self.submit()
        with self.tools.store.connect() as db:
            db.execute("UPDATE requests SET actor='operations:mc-god'")
        self.consumer.tick()
        self.assertEqual(self.game.calls, [])

    def test_registration_is_fixed_actor_with_no_actor_or_command_parameter(self):
        import inspect
        class App:
            tools = {}
            def tool(self):
                def register(fn):
                    self.tools[fn.__name__] = fn
                    return fn
                return register
        app = App()
        register_admin_tools(app, 'game:mc-herald', self.root)
        self.assertEqual(set(app.tools), set(TOOL_NAMES))
        for fn in app.tools.values():
            self.assertNotIn('actor', inspect.signature(fn).parameters)
            self.assertNotIn('command', inspect.signature(fn).parameters)
        denied = app.tools['world_admin_rule']('request-register', 'keepInventory', True)
        self.assertEqual(denied['code'], 'admin_actor_required')


class ProtocolTests(unittest.TestCase):
    def test_exact_native_translations_and_reject_unrelated_true_or_numbers(self):
        self.assertTrue(rule_value('\x1b[32mGamerule keepInventory is currently set to: true\x1b[0m', 'keepInventory'))
        self.assertEqual(time_value('The time is 1234'), 1234)
        for raw in ('Unknown command keepInventory true', 'Gamerule doFireTick is currently set to: true', 'true'):
            with self.assertRaises(ValueError):
                rule_value(raw, 'keepInventory')
        for raw in ('Scoreboard objective 300', 'The time is 1234\nThe time is 1235'):
            with self.assertRaises(ValueError):
                time_value(raw)

    def test_transport_cannot_send_raw_commands_or_disable_inventory_retention(self):
        for command in ('stop', 'kill @e', 'op Kirito', 'weather clear 601s', 'gamerule keepInventory false',
                        'time set 0', 'gamerule keepInventory true\nsay x'):
            self.assertFalse(NativeAdminRcon.allowed(command))

    def test_actual_transport_matches_ids_and_does_not_retry_lost_reply(self):
        def frame(rid, kind, text=''):
            payload = struct.pack('<ii', rid, kind) + text.encode() + b'\0\0'
            return struct.pack('<i', len(payload)) + payload
        class Socket:
            def __init__(self, data): self.data, self.sent = data, []
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def recv(self, n):
                value, self.data = self.data[:n], self.data[n:]
                return value
            def sendall(self, value): self.sent.append(value)
        with tempfile.TemporaryDirectory() as folder:
            secret = Path(folder)/'test-secret'
            secret.write_text('fixture-only')
            transport = NativeAdminRcon('mc', 25575, secret)
            connection = Socket(frame(1, 0) + frame(1, 2) + frame(999, 0, 'wrong reply') + frame(2, 0, 'correct reply'))
            with patch('world_admin_consumer.socket.create_connection', return_value=connection) as create:
                self.assertEqual(transport('gamerule keepInventory true'), 'correct reply')
                self.assertEqual(create.call_count, 1)
                self.assertEqual(len(connection.sent), 2)
            lost = Socket(frame(1, 2))
            with patch('world_admin_consumer.socket.create_connection', return_value=lost) as create:
                with self.assertRaises(ConnectionError):
                    transport('gamerule keepInventory true')
                self.assertEqual(create.call_count, 1)
                self.assertEqual(len(lost.sent), 2)

    def test_symlink_state_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root/'other').mkdir()
            try:
                (root/'admin').symlink_to(root/'other', target_is_directory=True)
            except OSError:
                self.skipTest('Platform cannot create symlinks')
            with self.assertRaisesRegex(ValueError, 'linked_admin_state'):
                AdminStore(root)


if __name__ == '__main__':
    unittest.main()
