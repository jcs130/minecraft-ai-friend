"""team_context must separate expired inspection records from current facts.

Not part of the fixed engineering checks baseline yet; pinned plans still cover
world_team_mcp.py via test_world_team*.py imports. Proposed for inclusion so the
behaviour below is executed in isolation too.

OperationsTools.snapshot() is imported lazily inside the team_context call, so
the fake-module patch must stay active while the tool runs; patching only around
registration would let the real snapshot reader touch /public paths.
"""
from pathlib import Path
import json
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace as N
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/ops'))
import world_team_mcp as mcp


class TeamContextFreshnessTests(unittest.TestCase):
    def context(self, snapshot):
        registered = {}

        class App:
            def tool(self):
                def deco(fn):
                    registered[fn.__name__] = fn
                    return fn
                return deco

        fake = N(snapshot=lambda: snapshot)
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        with patch.dict(sys.modules, {'operations_team_mcp': N(OperationsTools=lambda actor: fake)}):
            mcp.register_team_tools(App(), 'operations:mc-god', state=Path(tmp.name))
            return registered['team_context']()

    def test_stale_snapshot_sections_are_flagged_as_expired_records(self):
        result = self.context({'worldActionsAllowed': True, 'snapshots': {
            'world': {'fresh': True, 'data': {}},
            'health': {'fresh': False, 'ageSeconds': 7532.5, 'data': {'ok': False}}}})
        self.assertEqual(result['world']['staleSnapshots'], ['health'])
        self.assertNotIn('worldActionsAllowed', result['world'])
        self.assertEqual(result['world']['worldActionsExecuted'], 0)
        self.assertIn('expired inspection records', result['notice'])

    def test_fresh_context_stays_quiet_and_malformed_sections_are_ignored(self):
        result = self.context({'snapshots': {
            'world': {'fresh': True}, 'operations': {}, 'broken': 'not-a-dict'}})
        self.assertEqual(result['world']['staleSnapshots'], [])
        self.assertNotIn('expired inspection records', result['notice'])

    def test_unhealthy_services_are_summarised_from_health_record(self):
        result = self.context({'snapshots': {'health': {'fresh': True, 'data': {
            'ok': False, 'services': {
                'mc': {'ok': True}, 'qwenpaw': {'ok': False}, 'npc': {'ok': True}}}}}})
        self.assertEqual(result['world']['unhealthyServices'], ['qwenpaw'])
        self.assertIn('health inspection record', result['notice'])
        self.assertNotIn('that record is expired', result['notice'])

    def test_unhealthy_services_flag_expired_when_health_record_is_stale(self):
        result = self.context({'snapshots': {'health': {'fresh': False, 'data': {
            'ok': False, 'services': {'qwenpaw': {'ok': False}}}}}})
        self.assertEqual(result['world']['staleSnapshots'], ['health'])
        self.assertEqual(result['world']['unhealthyServices'], ['qwenpaw'])
        self.assertIn('that record is expired', result['notice'])

    def test_unhealthy_services_stay_quiet_when_health_data_missing_or_malformed(self):
        result = self.context({'snapshots': {'health': {'fresh': True, 'data': {}},
                                             'operations': {'fresh': True, 'data': {
                                                 'services': {'qwenpaw': {'ok': False}}}}}})
        self.assertEqual(result['world']['unhealthyServices'], [])
        self.assertNotIn('health inspection record', result['notice'])
        malformed = self.context({'snapshots': {'health': {'fresh': True, 'data': {
            'services': ['qwenpaw', 'npc']}}}})
        self.assertEqual(malformed['world']['unhealthyServices'], [])


class NpcLlmEnabledTests(unittest.TestCase):
    """case-761672: llmEnabled=false is explicit compose config, surfaced as such."""

    def context(self, npc, fresh=True):
        registered = {}

        class App:
            def tool(self):
                def deco(fn):
                    registered[fn.__name__] = fn
                    return fn
                return deco

        fake = N(snapshot=lambda: {'snapshots': {'world': {'fresh': fresh, 'data': {'npc': npc}}}})
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        with patch.dict(sys.modules, {'operations_team_mcp': N(OperationsTools=lambda actor: fake)}):
            mcp.register_team_tools(App(), 'operations:mc-god', state=Path(tmp.name))
            return registered['team_context']()

    def test_disabled_flag_is_summarised_as_explicit_configuration(self):
        result = self.context({'available': True, 'llmEnabled': False,
                               'spawnMissing': False, 'threads': [{'name': 'inbox', 'ok': True}]})
        self.assertIs(result['world']['npcLlmEnabled'], False)
        self.assertIn('NPC_LLM_ENABLED', result['notice'])
        self.assertIn('not by itself a service fault', result['notice'])
        self.assertIn('owner configuration decision', result['notice'])

    def test_enabled_flag_is_summarised_without_the_config_note(self):
        result = self.context({'available': True, 'llmEnabled': True})
        self.assertIs(result['world']['npcLlmEnabled'], True)
        self.assertNotIn('NPC_LLM_ENABLED', result['notice'])

    def test_absent_or_malformed_npc_record_stays_quiet(self):
        for npc in ({}, {'llmEnabled': 'false'}, {'llmEnabled': None}, 'not-a-dict'):
            result = self.context(npc)
            self.assertNotIn('npcLlmEnabled', result['world'])
            self.assertNotIn('NPC_LLM_ENABLED', result['notice'])

    def test_expired_world_record_qualifies_the_config_note(self):
        result = self.context({'llmEnabled': False}, fresh=False)
        self.assertEqual(result['world']['staleSnapshots'], ['world'])
        self.assertIs(result['world']['npcLlmEnabled'], False)
        self.assertIn('the world record carrying it is expired', result['notice'])


class NpcHealthSubchecksTests(unittest.TestCase):
    """case-874c6b4133a5affd763b: name the failing healthcheck sub-check from the record."""

    def context(self, npc, fresh=True):
        registered = {}

        class App:
            def tool(self):
                def deco(fn):
                    registered[fn.__name__] = fn
                    return fn
                return deco

        fake = N(snapshot=lambda: {'snapshots': {'world': {'fresh': fresh, 'data': {'npc': npc}}}})
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        with patch.dict(sys.modules, {'operations_team_mcp': N(OperationsTools=lambda actor: fake)}):
            mcp.register_team_tools(App(), 'operations:mc-god', state=Path(tmp.name))
            return registered['team_context']()

    def test_subcheck_fields_and_guild_states_are_surfaced(self):
        stamp = '2026-09-15T03:40:55.795Z'
        result = self.context({'available': True, 'updatedAt': stamp,
                               'rconLastOkAt': stamp, 'spellLastPollAt': stamp,
                               'guildRequestsLastPollAt': stamp,
                               'guildNpcs': {'ok': False, 'checkedAt': stamp, 'online': 0,
                                             'required': [{'key': 'guild_lan',
                                                           'state': 'missing_in_loaded_chunk'}]},
                               'threads': [{'name': 'inbox', 'ok': True}]})
        view = result['world']['npcHealthSubchecks']
        self.assertEqual(view['rconLastOkAt'], stamp)
        self.assertEqual(view['guildRequestsLastPollAt'], stamp)
        self.assertIs(view['guildNpcsOk'], False)
        self.assertEqual(view['guildNpcsCheckedAt'], stamp)
        self.assertEqual(view['guildNpcsStates'], {'guild_lan': 'missing_in_loaded_chunk'})
        self.assertIn('npcHealthSubchecks', result['notice'])
        self.assertIn('case-874c6b4133a5affd763b', result['notice'])

    @unittest.skipUnless(shutil.which('node'), 'Node is required for the real public projection')
    def test_raw_npc_health_reaches_team_context_through_actual_public_projection(self):
        raw = {'updated_at': 1789890709.329, 'rcon_last_ok': 1789890709.329,
               'spell_last_poll': 1789890709.329, 'guild_requests_last_poll': 1789890709.329,
               'guild_npcs': {'checked_at': 1789890709.329, 'ok': False, 'online': 1,
                              'required': [{'key': 'guild_lan', 'state': 'online', 'uuid': 'PRIVATE_SENTINEL'},
                                           {'key': 'hesu', 'state': 'missing_in_loaded_chunk'}]}}
        projection = Path(__file__).resolve().parents[1] / 'world/admin/read-model.mjs'
        code = ('import { projectWorld } from ' + json.dumps(projection.as_uri()) + ';'
                'import fs from "node:fs";'
                'console.log(JSON.stringify(projectWorld({npc:JSON.parse(fs.readFileSync(0,"utf8"))}).npc));')
        process = subprocess.run([shutil.which('node'), '--input-type=module', '-e', code],
                                 input=json.dumps(raw), text=True, encoding='utf-8', capture_output=True,
                                 timeout=15, check=True)
        self.assertNotIn('PRIVATE_SENTINEL', process.stdout)
        result = self.context(json.loads(process.stdout))
        view = result['world']['npcHealthSubchecks']
        for field in ('rconLastOkAt', 'spellLastPollAt', 'guildRequestsLastPollAt', 'guildNpcsCheckedAt'):
            self.assertEqual(view[field], '2026-09-20T07:51:49.329Z')
        self.assertIs(view['guildNpcsOk'], False)
        self.assertEqual(view['guildNpcsStates'], {'guild_lan': 'online', 'hesu': 'missing_in_loaded_chunk'})
        self.assertIn('npcHealthSubchecks', result['notice'])

    def test_partial_records_surface_available_fields_only(self):
        result = self.context({'guildNpcs': {'ok': True, 'required': 'not-a-list'}})
        view = result['world']['npcHealthSubchecks']
        self.assertIsNone(view['rconLastOkAt'])
        self.assertIs(view['guildNpcsOk'], True)
        self.assertEqual(view['guildNpcsStates'], {})

    def test_absent_or_malformed_subchecks_stay_quiet(self):
        for npc in ({}, {'threads': [{'name': 'inbox', 'ok': True}]},
                    {'rconLastOkAt': None, 'guildNpcs': 'not-a-dict'}, 'not-a-dict'):
            result = self.context(npc)
            self.assertNotIn('npcHealthSubchecks', result['world'])

    def test_expired_world_record_qualifies_the_subcheck_note(self):
        result = self.context({'rconLastOkAt': '2026-09-15T03:40:55.795Z'}, fresh=False)
        self.assertEqual(result['world']['staleSnapshots'], ['world'])
        self.assertIn('npcHealthSubchecks', result['world'])
        self.assertIn('the world record carrying them is expired', result['notice'])


class PlayersRosterTests(unittest.TestCase):
    """case-08e101df69170a7ece6d: players is a registry, not a live online list."""

    def context(self, players, observed=None, fresh=True):
        registered = {}

        class App:
            def tool(self):
                def deco(fn):
                    registered[fn.__name__] = fn
                    return fn
                return deco

        data = {'players': players}
        if observed is not None:
            data['world'] = {'observedPlayers': observed}
        fake = N(snapshot=lambda: {'snapshots': {'world': {'fresh': fresh, 'data': data}}})
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        with patch.dict(sys.modules, {'operations_team_mcp': N(OperationsTools=lambda actor: fake)}):
            mcp.register_team_tools(App(), 'operations:mc-god', state=Path(tmp.name))
            return registered['team_context']()

    def test_registry_names_cross_checked_against_observed_players(self):
        result = self.context(
            [{'name': 'Kirito', 'level': 17}, {'name': 'Goddess', 'level': 1},
             {'name': 'MengMeng', 'level': 45}],
            observed=['Goddess'])
        roster = result['world']['playersRoster']
        self.assertEqual(roster['registryCount'], 3)
        self.assertEqual(roster['registry'], ['Goddess', 'Kirito', 'MengMeng'])
        self.assertEqual(roster['observedPlayers'], ['Goddess'])
        self.assertEqual(roster['registryNotObserved'], ['Kirito', 'MengMeng'])
        self.assertEqual(roster['observedNotInRegistry'], [])
        self.assertIn('not a live online list', result['notice'])
        self.assertIn('case-08e101df69170a7ece6d', result['notice'])

    def test_observed_names_missing_from_registry_are_flagged(self):
        result = self.context([{'name': 'Kirito'}], observed=['Goddess'])
        roster = result['world']['playersRoster']
        self.assertEqual(roster['observedNotInRegistry'], ['Goddess'])

    def test_registry_without_observation_channel_reports_all_names_unobserved(self):
        result = self.context([{'name': 'Kirito'}, 'not-a-dict', {}, {'name': ''}])
        roster = result['world']['playersRoster']
        self.assertEqual(roster['registryCount'], 1)
        self.assertEqual(roster['registryNotObserved'], ['Kirito'])
        self.assertEqual(roster['observedPlayers'], [])

    def test_absent_or_malformed_players_stay_quiet(self):
        for players in ('not-a-list', {'name': 'Kirito'}, None):
            result = self.context(players)
            self.assertNotIn('playersRoster', result['world'])
            self.assertNotIn('playersRoster', result['notice'])

    def test_expired_world_record_qualifies_roster_note(self):
        result = self.context([{'name': 'Kirito'}], observed=[], fresh=False)
        self.assertEqual(result['world']['staleSnapshots'], ['world'])
        self.assertIn('playersRoster', result['world'])
        self.assertIn('the world record carrying it is expired', result['notice'])


if __name__ == '__main__':
    unittest.main()
