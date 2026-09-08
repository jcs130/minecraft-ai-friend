import asyncio
from copy import deepcopy
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/sidecar'))
from mcp_configuration import configure_client


POLICY = {'default_effect': 'deny', 'client_overrides': [], 'tool_defaults': [], 'tool_overrides': []}
CLIENT = {'enabled': True, 'tools': ['party_status']}


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.policy = {'default_effect': 'ask', 'client_overrides': [], 'tool_defaults': [], 'tool_overrides': [],
                       'unmanaged_rules_count': 0}
        self.pending_policy = None
        self.calls = []
        self.now = 0

    def api(self, method, path, role, body=None):
        self.calls.append((method, path))
        if path == '/mcp' and method == 'POST' or path == '/mcp/qd_party' and method == 'PUT':
            self.pending_policy = deepcopy(self.policy)
            return {}
        if path == '/mcp/tools/qd_party':
            if self.pending_policy is not None:
                self.policy, self.pending_policy = self.pending_policy, None
            return [{'name': 'party_status', 'enabled': True}]
        if path == '/mcp/policy/qd_party':
            if method == 'PUT': self.policy = deepcopy(body) | {'unmanaged_rules_count': 0}
            return deepcopy(self.policy)
        self.fail('unexpected operation')

    def test_new_connection_completes_before_policy_is_saved(self):
        configure_client(self.api, 'fixture', 'qd_party', CLIENT, POLICY, exists=False)
        self.assertEqual(self.calls[:3], [('POST', '/mcp'), ('GET', '/mcp/tools/qd_party'), ('PUT', '/mcp/policy/qd_party')])
        self.assertEqual(self.policy['default_effect'], 'deny')
        self.assertIsNone(self.pending_policy)

    def test_existing_reconnect_begins_with_policy_already_applied(self):
        configure_client(self.api, 'fixture', 'qd_party', CLIENT, POLICY, exists=True)
        self.assertLess(self.calls.index(('PUT', '/mcp/policy/qd_party')), self.calls.index(('PUT', '/mcp/qd_party')))
        self.assertEqual(self.pending_policy['default_effect'], 'deny')
        self.api('GET', '/mcp/tools/qd_party', 'fixture')
        self.assertEqual(self.policy['default_effect'], 'deny')

    def test_unknown_write_is_never_retried(self):
        calls = []
        def lost(method, path, role, body=None):
            calls.append((method, path))
            raise TimeoutError('lost acknowledgement')
        with self.assertRaises(TimeoutError):
            configure_client(lost, 'fixture', 'qd_party', CLIENT, POLICY, exists=False)
        self.assertEqual(calls, [('POST', '/mcp')])

    def test_wait_retries_reads_only_and_fails_closed_if_never_active(self):
        def unavailable(method, path, role, body=None):
            self.calls.append((method, path))
            if method == 'POST': return {}
            raise urllib.error.HTTPError('fixture', 503, 'connecting', None, None)
        def sleep(seconds): self.now += seconds
        with self.assertRaisesRegex(ValueError, 'activation_pending'):
            configure_client(unavailable, 'fixture', 'qd_party', CLIENT, POLICY, exists=False,
                             timeout=1, clock=lambda: self.now, sleep=sleep)
        self.assertEqual(sum(method == 'POST' for method, _ in self.calls), 1)
        self.assertFalse(any(method == 'PUT' for method, _ in self.calls))


class NativeQwenReconnectTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_manager_reproduces_stale_policy_and_barrier_prevents_it(self):
        try:
            from qwenpaw.drivers.manager import DriverManager
            from qwenpaw.drivers.contracts import DriverCard
            from qwenpaw.drivers.policy_types import DriverPolicy
        except ModuleNotFoundError as error:
            if error.name == 'qwenpaw': self.skipTest('Run in pinned Qwen image')
            raise
        card = DriverCard(name='qd_party', protocol='mcp', endpoint={}, credentials={}, config={}, enabled=True,
                          policy=DriverPolicy(default_effect='ask', rules=[]))
        started, finish = asyncio.Event(), asyncio.Event()
        class Store:
            def __init__(self): self.card = deepcopy(card)
            async def stored_path(self, name): return Path('/fixture/card.yaml')
            async def load_path(self, path): return deepcopy(self.card)
            async def save(self, value): self.card = deepcopy(value)
        store = Store()
        manager = object.__new__(DriverManager)
        manager._card_store, manager._lock = store, asyncio.Lock()
        manager._handler_scopes, manager._handlers = {}, {}
        manager._validate_card_for_registered_protocol = lambda value: value
        async def build(value):
            started.set(); await finish.wait()
            return SimpleNamespace(card=value, set_policy=lambda policy: setattr(value, 'policy', policy))
        async def shutdown(value): pass
        manager._build_and_init_handler, manager._shutdown_handler = build, shutdown
        manager._runtime_info_from_card = lambda value: value
        connecting = asyncio.create_task(manager.reload_driver('qd_party'))
        await started.wait()
        wanted = deepcopy(card); wanted.policy = DriverPolicy(default_effect='deny', rules=[])
        await manager.sync_driver_policy(wanted)
        self.assertEqual(store.card.policy.default_effect, 'deny')
        finish.set(); await connecting
        self.assertEqual(store.card.policy.default_effect, 'ask', 'Installed native stale-card race must be reproduced')
        # The activation barrier is now crossed: persist the intended policy.
        await manager.sync_driver_policy(wanted)
        self.assertEqual(store.card.policy.default_effect, 'deny')
        # Existing updates begin with the desired policy; even a late reconnect
        # republishes that same policy rather than the initial ask fallback.
        await manager.reload_driver('qd_party')
        self.assertEqual(store.card.policy.default_effect, 'deny')


if __name__ == '__main__': unittest.main()
