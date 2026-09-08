from copy import deepcopy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace as N
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
import party_role_capabilities as party


def manifest():
    return {'schema': 1, 'enabled': True, 'partyId': 'fixture-party', 'revision': 1,
            'members': [{'agentId': 'qd-survivor', 'bodyUuid': str(uuid.UUID(int=1)), 'displayName': 'Survivor', 'kind': 'survivor'},
                        {'agentId': 'fixture-maid', 'bodyUuid': str(uuid.UUID(int=2)), 'displayName': 'Maid', 'kind': 'maid'}]}


def card_fixture():
    return N(name=party.DRIVER, protocol='mcp', enabled=True,
             endpoint={'transport':'streamable_http', 'url':party.URL,
                       'headers':{'Authorization':{'source':'credential','credential':'static','field':'authorization'}}},
             credentials={'static':N(kind='static',ref='mcp/qd_party')}, config={'tools':list(party.TOOLS)},
             policy=N(default_effect='deny', rules=[N(subject='*',effect='allow',condition=None,
                target=N(kind='tool',name=name), principal=N(source_type='channel',source_value='console',
                    subject_type='all',subject_value='')) for name in party.TOOLS]))


class PartyCapabilityTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.path = self.root / 'roles.json'
        self.maid_path = self.root / 'maids.json'
        self.maid_path.write_text(json.dumps({'schema':1,'bindingsValid':True,'independentSessions':True,
            'registeredCount':1,'activeRoleIds':['fixture-maid']}))
        self.value = manifest(); self.save()
        env = patch.dict(os.environ, {party.MANIFEST_ENV:str(self.path),'MAID_ROLES_MANIFEST_FILE':str(self.maid_path)})
        env.start(); self.addCleanup(env.stop)
        self.authorization = 'Bearer ' + 'fixture_' * 8
        self.card = card_fixture()
        self.client = party.client_payload(self.authorization)
        self.policy = party.policy_payload() | {'unmanaged_rules_count':0}
        self.api = {'/mcp':[{'key':'numen_survival'}, {'key':'qd_learning'}, {'key':'qd_party'}, {'key':'qd_world_team'}],
            '/mcp/qd_party':self.client, '/mcp/policy/qd_party':self.policy,
            '/mcp/tools/qd_party':[{'name':name,'enabled':True} for name in party.TOOLS]}
        self.calls = []

    def save(self):
        self.path.write_text(json.dumps(self.value), encoding='utf8')

    def get(self, path, aid=None):
        self.calls.append((path,aid))
        return self.api[path]

    def test_only_manifest_pair_gains_the_driver(self):
        self.assertEqual(party.party_roles(), {'qd-survivor','fixture-maid'})
        for role in ('qd-survivor','fixture-maid'):
            expected = {'qd_learning','qd_party','qd_world_team'}
            self.assertEqual(party.expected_drivers(role, {'qd_learning'}), expected)
        for role in ('mc-god','mc-herald','qd-maid-dialogue','another-maid','default',None):
            expected = {'qd_learning'} | ({'qd_world_team'} if role in ('mc-god','mc-herald','qd-maid-dialogue') else set())
            self.assertEqual(party.expected_drivers(role, {'qd_learning'}), expected)

    def test_absent_optional_manifest_means_disabled_but_configured_missing_is_error(self):
        missing = self.root / 'absent.json'
        with patch.dict(os.environ, {}, clear=True), patch.object(party,'DEFAULT_MANIFEST',str(missing)):
            self.assertEqual(party.party_members(), ())
        with patch.dict(os.environ, {party.MANIFEST_ENV:str(missing)}):
            with self.assertRaisesRegex(AssertionError,'manifest missing'): party.party_roles()
        with patch.dict(os.environ, {party.MANIFEST_ENV:''}):
            with self.assertRaisesRegex(AssertionError,'path missing'): party.party_roles()

    def test_unregistered_maid_or_template_cannot_be_a_partner(self):
        for role in ('unregistered-maid','qd-maid-dialogue','mc-god','default'):
            self.value['members'][1]['agentId'] = role; self.save()
            with self.assertRaises(AssertionError): party.party_roles()

    def test_bad_or_private_manifest_fails_closed(self):
        mutations = [lambda m:m.update(enabled=False), lambda m:m.update(schema=True),
                     lambda m:m.update(revision=0), lambda m:m.update(mcpToken='not-public'),
                     lambda m:m['members'].pop(), lambda m:m['members'].append(deepcopy(m['members'][1])),
                     lambda m:m['members'][1].update(bodyUuid=m['members'][0]['bodyUuid']),
                     lambda m:m['members'][1].update(kind='survivor'),
                     lambda m:m['members'][1].update(mcpToken='never-export'),
                     lambda m:m['members'][0].update(agentId='different-survivor'),
                     lambda m:m['members'][0].update(displayName='')]
        for mutation in mutations:
            self.value=manifest(); mutation(self.value); self.save()
            with self.assertRaises(AssertionError): party.party_roles()
        self.path.write_text('{broken')
        with self.assertRaises(ValueError): party.party_roles()

    def test_native_payload_helpers_are_fresh_exact_values_not_profile_mutations(self):
        first = party.client_payload(self.authorization)
        first['tools'].append('shell')
        self.assertEqual(party.client_payload(self.authorization)['tools'], list(party.TOOLS))
        p = party.policy_payload(); p['tool_overrides'][0]['effect']='deny'
        self.assertEqual(party.policy_payload()['tool_overrides'][0]['effect'],'allow')
        self.assertFalse(set(first) & {'active_model','model','running','mcp'})
        for token in ('Bearer bad','Bearer '+'x'*200,'Bearer '+('x'*32)+'\n','Basic '+'x'*40):
            with self.assertRaises(AssertionError): party.client_payload(token)

    def test_native_card_and_legacy_equivalent_duplicate_both_validate(self):
        party.check_party_card(self.card,self.authorization)
        party.check_party_card(self.card,self.authorization,self.client)
        self.client['headers']['Authorization']='Bearer '+'different_'*8
        with self.assertRaises(AssertionError): party.check_party_card(self.card,self.authorization,self.client)

    def test_plaintext_env_or_foreign_native_credentials_are_rejected(self):
        for binding in ('Bearer '+'x'*64, {'source':'env','name':'PARTY_TOKEN'},
                        {'source':'credential','credential':'static','field':'authorization','format':'{value}'}):
            self.card=card_fixture(); self.card.endpoint['headers']['Authorization']=binding
            with self.assertRaises(AssertionError): party.check_party_card(self.card,self.authorization)
        self.card=card_fixture(); self.card.credentials['static'].ref='mcp/another-role'
        with self.assertRaises(AssertionError): party.check_party_card(self.card,self.authorization)

    def test_native_card_has_exactly_three_console_only_rules_and_no_wildcards(self):
        mutations=[lambda c:setattr(c.policy,'default_effect','allow'),
                   lambda c:setattr(c.policy.rules[0],'principal',None),
                   lambda c:setattr(c.policy.rules[0].principal,'source_value','*'),
                   lambda c:setattr(c.policy.rules[0].principal,'source_value','discord'),
                   lambda c:setattr(c.policy.rules[0],'condition',{'allow':True}),
                   lambda c:c.policy.rules.append(c.policy.rules[0]),
                   lambda c:setattr(c.policy.rules[0].target,'name','*'),
                   lambda c:c.config['tools'].append('shell'),
                   lambda c:c.endpoint.update(url='http://host:8088/mcp')]
        for mutation in mutations:
            self.card=card_fixture(); mutation(self.card)
            with self.assertRaises(AssertionError): party.check_party_card(self.card,self.authorization)

    def test_live_api_reads_real_inventory_tool_flags_and_exact_policy(self):
        party.check_party_inventory(self.get,'qd-survivor',{'numen_survival','qd_learning'})
        party.check_party_api(self.get,'qd-survivor')
        self.assertEqual(len(self.calls),4)
        self.assertTrue(all(role=='qd-survivor' for _,role in self.calls))
        self.api['/mcp/tools/qd_party'][0]['enabled']=False
        with self.assertRaises(AssertionError): party.check_party_api(self.get,'qd-survivor')
        self.api['/mcp/tools/qd_party'][0]['enabled']=True
        self.policy['unmanaged_rules_count']=1
        with self.assertRaises(AssertionError): party.check_party_api(self.get,'qd-survivor')

    def test_live_extra_driver_disabled_duplicate_or_wrong_channel_rejected(self):
        with self.assertRaises(AssertionError):
            party.check_party_inventory(self.get,'mc-god',{'numen_survival','qd_learning'})
        self.api['/mcp'].append({'key':'foreign'})
        with self.assertRaises(AssertionError):
            party.check_party_inventory(self.get,'qd-survivor',{'numen_survival','qd_learning'})
        self.api['/mcp'].pop()
        self.policy['tool_overrides'][0]['source_value']='*'
        with self.assertRaises(AssertionError): party.check_party_api(self.get,'qd-survivor')
        self.policy['tool_overrides'][0]['source_value']='console'
        self.policy['tool_overrides'][0]=self.policy['tool_overrides'][1]
        with self.assertRaises(AssertionError): party.check_party_api(self.get,'qd-survivor')

    def test_workspace_requires_bound_card_and_encrypted_secret_without_printing_it(self):
        folder = self.root / 'workspace'; folder.mkdir()
        path = folder/'drivers/mcp/qd_party.yaml'
        agent={'mcp':{'clients':{'qd_learning':{}}}}
        credential=N(kind='static',secrets={'authorization':self.authorization},public={})
        storage=N(load_card=lambda _:self.card)
        credentials=N(AsyncCredentialStore=lambda _:N(get_sync=lambda name:credential))
        with patch.dict(sys.modules,{'qwenpaw.drivers.storage':storage,'qwenpaw.drivers.credentials':credentials}):
            self.assertTrue(party.check_party_workspace(folder,'qd-survivor',agent,[path]))
            with self.assertRaisesRegex(AssertionError,'missing'):
                party.check_party_workspace(folder,'qd-survivor',agent,[])
            with self.assertRaisesRegex(AssertionError,'unbound'):
                party.check_party_workspace(folder,'mc-god',agent,[path])
            self.assertFalse(party.check_party_workspace(folder,'mc-god',agent,[]))
            agent['mcp']['clients']['qd_party']=self.client
            with self.assertRaisesRegex(AssertionError,'unbound'):
                party.check_party_workspace(folder,'mc-god',agent,[])
            credential.public={'authorization':self.authorization}
            with self.assertRaises(AssertionError):
                party.check_party_workspace(folder,'qd-survivor',agent,[path])

    def test_bound_maid_can_add_party_but_old_maid_native_allow_is_still_rejected(self):
        from test_game_maid_driver_health import health, MaidDriverHealth
        fixture = MaidDriverHealth(); fixture.setUp()
        fixture.clients['qd_party'] = self.client
        health.check_maid_card(fixture.card,fixture.clients,fixture.authorization,'fixture-maid')
        with self.assertRaises(AssertionError):
            health.check_maid_card(fixture.card,fixture.clients,fixture.authorization,'another-maid')
        fixture.card.policy.default_effect = 'allow'
        with self.assertRaises(AssertionError):
            health.check_maid_card(fixture.card,fixture.clients,fixture.authorization,'fixture-maid')


if __name__ == '__main__': unittest.main()
