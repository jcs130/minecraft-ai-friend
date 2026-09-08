"""Offline checks of the real NPC heartbeat's effective feature flags."""
import ast
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock


SOURCE = Path(__file__).resolve().parents[1] / 'world/sidecar/mc_npc.py'


class EndOfHeartbeat(BaseException):
    pass


class NpcHealthFlags(unittest.TestCase):
    def snapshot(self, *, enabled=False, autogenerate=False, basic=None, env=None):
        records = []

        class FakePath:
            def __init__(self, path):
                self.path = path

            def __truediv__(self, part):
                return FakePath(self.path + '/' + part)

            def with_suffix(self, suffix):
                return FakePath(self.path.rsplit('.', 1)[0] + suffix)

            def write_text(self, text, **kwargs):
                records.append((self.path, json.loads(text)))

        def stop(_):
            raise EndOfHeartbeat()

        tree = ast.parse(SOURCE.read_text(encoding='utf-8-sig'))
        functions = [node for node in tree.body
                     if isinstance(node, ast.FunctionDef) and node.name == 'npc_heartbeat_loop']
        self.assertEqual(len(functions), 1)
        commands, replace = Mock(), Mock()
        modules = {} if basic is None else {'mc_guild': SimpleNamespace(BASIC_QUESTS=basic)}
        namespace = {
            'Path': FakePath, 'DATA': '/fixture', 'json': json,
            'time': SimpleNamespace(time=lambda: 100, sleep=stop),
            'os': SimpleNamespace(getpid=lambda: 123, replace=replace, environ=env or {}),
            'sys': SimpleNamespace(modules=modules), 'R': SimpleNamespace(cmd=commands),
            '_RCON_LAST_OK': 100, '_SPELL_LAST_POLL': 99, '_SPELL_CONSUMED': 7,
            '_NPC_THREADS': {'health': SimpleNamespace(is_alive=lambda: True)},
            'HOST': 'fixture-mc', 'PORT': 25575, 'SPAWN_MISSING': False,
            'GUILD_AUTOGENERATE': autogenerate,
            # Deliberately include private provider fields: the writer must only
            # project the effective enabled flag, never this configuration object.
            'CFG': {'llm': {'enabled': enabled, 'endpoint': 'fixture-not-exported',
                            'api_key': 'fixture-not-exported', 'model': 'fixture-not-exported'}},
        }
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(SOURCE), 'exec'), namespace)
        with self.assertRaises(EndOfHeartbeat):
            namespace['npc_heartbeat_loop']()
        commands.assert_not_called()
        replace.assert_called_once()
        self.assertEqual(records[0][0], '/fixture/npc-health.tmp')
        self.assertEqual(len(records), 1)
        self.assertEqual(replace.call_args.args[1].path, '/fixture/npc-health.json')
        return records[0][1]

    def test_llm_flag_uses_effective_cfg_not_environment_or_original_file(self):
        self.assertFalse(self.snapshot(enabled=False, env={'NPC_LLM_ENABLED': '1'})['llm_enabled'])
        self.assertTrue(self.snapshot(enabled=True, env={'NPC_LLM_ENABLED': '0'})['llm_enabled'])

    def test_loaded_guild_settings_take_precedence_over_environment(self):
        state = self.snapshot(autogenerate=False, basic=False,
                              env={'NPC_GUILD_BASIC_QUESTS': '1', 'NPC_GUILD_AUTOGENERATE': '1'})
        self.assertFalse(state['guild_autogenerate'])
        self.assertFalse(state['basic_quests'])
        self.assertTrue(self.snapshot(autogenerate=True, basic=True)['guild_autogenerate'])

    def test_early_heartbeat_preserves_original_basic_quest_environment_default(self):
        self.assertTrue(self.snapshot()['basic_quests'])
        self.assertTrue(self.snapshot(env={'NPC_GUILD_BASIC_QUESTS': '1'})['basic_quests'])
        self.assertFalse(self.snapshot(env={'NPC_GUILD_BASIC_QUESTS': '0'})['basic_quests'])
        self.assertFalse(self.snapshot(env={'NPC_GUILD_BASIC_QUESTS': 'true'})['basic_quests'])

    def test_only_public_boolean_flags_are_added(self):
        state = self.snapshot()
        old_fields = {'updated_at', 'pid', 'rcon_last_ok', 'spell_last_poll', 'spell_consumed',
                      'threads', 'rcon_target', 'spawn_missing'}
        new_fields = {'llm_enabled', 'guild_autogenerate', 'basic_quests', 'guild_requests_enabled'}
        self.assertEqual(set(state), old_fields | new_fields | {'guild_requests_last_poll', 'guild_npcs'})
        self.assertTrue(all(type(state[name]) is bool for name in new_fields))
        self.assertEqual(state['guild_requests_last_poll'], 0)
        self.assertEqual(state['guild_npcs'], {})
        self.assertNotIn('fixture-not-exported', json.dumps(state))

    def test_existing_health_fields_and_atomic_publication_are_preserved(self):
        state = self.snapshot()
        self.assertEqual(state['updated_at'], 100)
        self.assertEqual(state['rcon_last_ok'], 100)
        self.assertEqual(state['spell_last_poll'], 99)
        self.assertEqual(state['spell_consumed'], 7)
        self.assertEqual(state['threads'], {'health': True})
        self.assertEqual(state['rcon_target'], {'host': 'fixture-mc', 'port': 25575})
        self.assertFalse(state['spawn_missing'])


if __name__ == '__main__':
    unittest.main()
