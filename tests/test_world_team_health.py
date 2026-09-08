from copy import deepcopy
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace as N
import unittest
from unittest.mock import patch

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
import world_team_profiles as team
from operations_team_health import check_team_configuration


def team_card(role, runtime, key=None):
    key = key or team.DRIVER
    client = team.bindings(role, runtime)[key]
    return N(name=key, protocol='mcp', enabled=True,
             endpoint={k: deepcopy(client[k]) for k in ('transport', 'command', 'args', 'env')},
             credentials={}, config={'tools': list(client['tools'])},
             policy=N(default_effect='deny', rules=[N(subject='*', effect='allow', condition=None,
                 target=N(kind='tool', name=name), principal=N(source_type='channel', source_value='console',
                    subject_type='all', subject_value='')) for name in client['tools']]))


class WorldTeamHealthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name) / 'mc-god'; self.folder.mkdir()
        self.profile = {'id': 'mc-god', 'name': '天神 · 世界工程师', 'mcp': {'clients': {
            'qiandeng_operations': {}, 'qd_learning': {}, **team.bindings('mc-god', 'operations')}}}
        self.cards = {key: team_card('mc-god', 'operations', key) for key in team.bindings('mc-god', 'operations')}
        self.paths = [self.folder / ('drivers/mcp/' + name + '.yaml') for name in self.profile['mcp']['clients']]
        self.api = {'/mcp': [{'key': name} for name in self.profile['mcp']['clients']]}
        for key, client in team.bindings('mc-god', 'operations').items():
            self.api['/mcp/' + key] = deepcopy(client)
            self.api['/mcp/policy/' + key] = {**team.policy_payload(client['tools']), 'unmanaged_rules_count': 0}
            self.api['/mcp/tools/' + key] = [{'name': name, 'enabled': True} for name in client['tools']]

    def check(self):
        (self.folder / 'agent.json').write_text(json.dumps(self.profile), encoding='utf8')
        with patch.dict(sys.modules, {'qwenpaw.drivers.storage': N(load_card=lambda path: self.cards[Path(path).stem])}):
            check_team_configuration(self.folder, self.profile, 'mc-god', self.api.__getitem__, self.paths)

    def test_ops_engineer_requires_exact_team_and_five_engineering_tools(self):
        self.check()
        self.assertEqual(len(self.cards['qd_engineering'].config['tools']), 5)
        self.assertNotIn('qd_engineering', team.expected_drivers('mc-god', 'game', set()))
        self.assertNotIn('qd_engineering', team.expected_drivers('mc-herald', 'operations', set()))

    def test_missing_or_foreign_legacy_card_and_api_inventory_fail(self):
        for layer in ('profile', 'cards', 'api'):
            with self.subTest(layer=layer):
                old_profile, old_paths, old_api = deepcopy(self.profile), list(self.paths), deepcopy(self.api)
                if layer == 'profile': del self.profile['mcp']['clients']['qd_engineering']
                elif layer == 'cards': self.paths.append(self.folder / 'drivers/mcp/foreign.yaml')
                else: self.api['/mcp'].append({'key': 'foreign'})
                with self.assertRaises(AssertionError): self.check()
                self.profile, self.paths, self.api = old_profile, old_paths, old_api

    def test_native_disabled_wrong_actor_or_tool_drift_fail(self):
        for mutation in ('disabled', 'actor', 'tool'):
            with self.subTest(mutation=mutation):
                saved = deepcopy(self.cards)
                card = self.cards['qd_world_team']
                if mutation == 'disabled': card.enabled = False
                elif mutation == 'actor': card.endpoint['args'][-1] = 'game:mc-god'
                else: card.config['tools'].append('arbitrary_shell')
                with self.assertRaises(AssertionError): self.check()
                self.cards = saved

    def test_engineering_requires_console_rules_and_actual_enabled_tools(self):
        self.cards['qd_engineering'].policy.rules[0].principal.source_value = '*'
        with self.assertRaises(AssertionError): self.check()
        self.cards['qd_engineering'] = team_card('mc-god', 'operations', 'qd_engineering')
        self.api['/mcp/tools/qd_engineering'][0]['enabled'] = False
        with self.assertRaises(AssertionError): self.check()

    def test_old_display_name_does_not_hide_runtime_identity_confusion(self):
        self.profile['name'] = '灯语女神'
        with self.assertRaises(AssertionError): self.check()

    def test_optional_legacy_text_profile_and_strict_deployed_team_are_distinct(self):
        from test_register_world_agents import profile
        from world_agent_profiles import closed_profile, validate_profile
        agent = closed_profile(profile(), 'qd-guild-planner')
        agent['mcp']['clients'].pop(team.DRIVER, None)
        validate_profile(agent, 'qd-guild-planner', team=False)
        with self.assertRaises(AssertionError): validate_profile(agent, 'qd-guild-planner', team=True)
        agent['mcp']['clients'].update(team.bindings('qd-guild-planner', 'game'))
        validate_profile(agent, 'qd-guild-planner', team=True)
        self.assertEqual(agent['name'], '公会任务策划')
        agent['mcp']['clients']['foreign'] = {}
        with self.assertRaises(AssertionError): validate_profile(agent, 'qd-guild-planner', team=True)

    def test_every_base_game_role_and_newly_registered_maid_has_exact_team_api(self):
        from test_game_maid_driver_health import MaidDriverHealth, health
        for role in ('mc-god','mc-herald','qd-survivor','qd-guild-planner','qd-villager-dialogue','qd-maid-dialogue'):
            self.assertEqual(team.expected_drivers(role, 'game', {'qd_learning'}), {'qd_learning','qd_world_team'})
        manifest = self.folder / 'maids.json'
        manifest.write_text(json.dumps({'schema':1,'bindingsValid':True,'independentSessions':True,
            'registeredCount':1,'activeRoleIds':['fixture-maid']}))
        fixture=MaidDriverHealth();fixture.setUp()
        with patch.dict(os.environ,{'MAID_ROLES_MANIFEST_FILE':str(manifest)}):
            # membership is resolved after import, so registration cannot get
            # stuck with a cached pre-registration tool inventory.
            client=team.client('fixture-maid','game')
            fixture.api['/mcp'].append({'key':team.DRIVER})
            fixture.api['/mcp/'+team.DRIVER]=deepcopy(client)
            fixture.api['/mcp/policy/'+team.DRIVER]={**team.policy_payload(client['tools']),'unmanaged_rules_count':0}
            fixture.api['/mcp/tools/'+team.DRIVER]=[{'name':name,'enabled':True} for name in client['tools']]
            fixture.check_api()
            fixture.api['/mcp/tools/'+team.DRIVER][0]['enabled']=False
            with self.assertRaises(AssertionError):fixture.check_api()


if __name__ == '__main__': unittest.main()
