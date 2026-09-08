"""No live world: UUID selectors, read-only health, and exact profile merge."""
import ast
import importlib.util
import json
import os
from pathlib import Path
import random
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/sidecar'))
import npc_identity as identity


class BindingTests(unittest.TestCase):
    def setUp(self):
        self.uuid = '11111111-1111-1111-1111-111111111111'
        self.bound = {'uuid': self.uuid, 'entityType': 'minecraft:villager', 'dimension': 'minecraft:overworld',
                      'preservePosition': True, 'lastKnownPosition': [-531, 67, 903], 'observedAt': 1}
        self.profile = {'key': 'guild_lan', 'tag': 'npc_guild_lan', 'carrier': 'base_villager',
                        'entityBinding': self.bound, 'spawn': [999, 999, 999]}

    def test_selector_is_exact_uuid_type_and_tag_never_a_nearest_clone(self):
        text = identity.typed_uuid_selector(self.uuid, 'npc_guild_lan')
        self.assertIn('type=minecraft:villager,tag=npc_guild_lan,nbt={UUID:[I;', text)
        self.assertNotIn('sort=nearest', text)
        self.assertEqual(identity.parse_uuid('Fixture data: [I; 286331153, 286331153, 286331153, 286331153]'), self.uuid)
        for bad in ('@e', self.uuid + ' x'):
            with self.assertRaises(ValueError): identity.typed_uuid_selector(bad)

    def test_live_position_parser_accepts_native_exponents_but_not_missing_or_nonfinite(self):
        self.assertEqual(identity.parse_position('NPC data: [-5.31E2d, 67.0d, 9.03e2d]\n'), (-531, 67, 903))
        for text in ('No entity was found', 'NPC data: [NaNd, 1d, 2d]', 'NPC data: [1e999d, 1d, 2d]'):
            self.assertIsNone(identity.parse_position(text))
        self.assertEqual(identity.parse_name('岚 has the following entity data: \'"公会接待员·岚"\'\n'), '公会接待员·岚')

    def test_bad_binding_never_falls_back_to_legacy_tag(self):
        with self.assertRaises(ValueError): identity.binding(self.profile | {'entityBinding': self.bound | {'uuid': '@e'}})

    def test_contract_roles_require_binding_and_matching_profession(self):
        self.assertTrue(identity.contract_issuer(self.profile | {'profession': 'cartographer'}, 'reception'))
        self.assertFalse(identity.contract_issuer(self.profile | {'profession': 'farmer'}, 'reception'))
        self.assertFalse(identity.contract_issuer(self.profile | {'profession': 'cartographer'}, 'hunt'))
        self.assertFalse(identity.contract_issuer({'key': 'hesu', 'profession': 'farmer', 'carrier': 'base_villager'}, 'hunt'))

    def test_new_goods_quests_exclude_unbound_and_wrong_jobs_and_preserve_existing_day(self):
        source = ROOT / 'world/sidecar/mc_npc.py'
        tree = ast.parse(source.read_text(encoding='utf-8-sig'))
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'gen_quests')
        template = {'item': 'bread', 'zh': '面包', 'count': 3, 'emerald': 1}
        good = self.profile | {'key': 'jingshui', 'display': '静水', 'profession': 'cleric', 'quests': [template]}
        invalid = self.profile | {'key': 'shilei', 'display': '石磊', 'profession': 'nitwit', 'quests': [template]}
        unbound = {'key': 'zhujiu', 'display': '烛九', 'profession': 'toolsmith', 'carrier': 'base_villager', 'quests': [template]}
        with tempfile.TemporaryDirectory() as tmp:
            llm = Mock(return_value={})
            namespace = {'os': os, 'random': random.Random(1), 'CFG': {'quests': {'per_villager_chance': 1, 'daily_cap': 12}},
                         'PROFILES': [good,invalid,unbound], 'quests_path': lambda day: Path(tmp)/(day+'.json'),
                         'qwen_quests': llm, 'alive_pos':lambda _: [0,64,0], 'print': lambda *a, **kw: None}
            exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), namespace)
            doc = namespace['gen_quests']('2026-09-09')
            self.assertEqual([q['villager'] for q in doc['quests']], ['jingshui'])
            self.assertEqual(doc['availability']['eligibleIssuers'], ['jingshui'])
            llm.assert_called_once_with([good], '2026-09-09')
            before = (Path(tmp)/'2026-09-09.json').read_bytes()
            namespace['PROFILES'] = []
            self.assertEqual(namespace['gen_quests']('2026-09-09'), doc)
            self.assertEqual((Path(tmp)/'2026-09-09.json').read_bytes(), before)
            empty = namespace['gen_quests']('2026-09-10')
            self.assertEqual(empty['quests'], [])
            self.assertEqual(empty['availability']['reason'], 'no_bound_qualified_issuers')
            broken = Path(tmp)/'2026-09-11.json'; broken.write_text('{broken', encoding='utf8')
            with self.assertRaises(ValueError): namespace['gen_quests']('2026-09-11')
            self.assertEqual(broken.read_text(encoding='utf8'), '{broken')

    def test_required_npcs_report_unloaded_separately_without_loading_chunks(self):
        commands = []
        def cmd(text):
            commands.append(text)
            return 'Test failed' if 'if loaded' in text else 'Test passed, count: 1'
        npc = SimpleNamespace(PROFILES=[self.profile], R=SimpleNamespace(cmd=cmd), alive_pos=Mock(return_value=None))
        guild = SimpleNamespace(board_today=lambda: {'board': []})
        result = identity.required_npc_health(npc, guild)
        self.assertTrue(result['ok'])
        self.assertEqual(result['required'][0]['state'], 'chunk_unloaded')
        self.assertFalse(result['required'][0]['positionFresh'])
        self.assertFalse(any('forceload' in c or 'summon' in c or 'tp ' in c for c in commands))
        npc.R.cmd = lambda _: 'Test passed, count: 1'
        result = identity.required_npc_health(npc, guild)
        self.assertFalse(result['ok'])
        self.assertEqual(result['required'][0]['state'], 'missing_in_loaded_chunk')
        npc.alive_pos.return_value = (-531, 67, 903)
        self.assertEqual(identity.required_npc_health(npc, guild)['online'], 1)

    def test_bound_caretaker_never_teleports_to_imported_spawn(self):
        source = ROOT / 'world/sidecar/mc_npc.py'
        tree = ast.parse(source.read_text(encoding='utf-8-sig'))
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'heal_npcs')
        rcon = SimpleNamespace(cmd=Mock())
        namespace = {'CFG': {}, 'PROFILES': [self.profile], 'R': rcon, '_MISS': {}, 'dedup_npc': lambda _: None,
                     'alive_pos': lambda _: (-531, 67, 903), 'ground_y': Mock(side_effect=AssertionError('no ground correction'))}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), namespace)
        namespace['heal_npcs']()
        rcon.cmd.assert_not_called()

    def test_reviewed_merge_changes_only_six_bindings_and_preserves_all_other_fields(self):
        spec = importlib.util.spec_from_file_location('guild_bind_tool_fixture', ROOT / 'tools/bind_guild_npcs.py')
        tool = importlib.util.module_from_spec(spec); spec.loader.exec_module(tool)
        plan = json.loads((ROOT / 'config/guild-npc-bindings.json').read_text(encoding='utf8'))
        profiles = {'villagers': [{'key': r['key'], 'tag': r['tag'], 'display': r['display'], 'carrier': 'base_villager',
                                  'spawn': [1, 2, 3], 'shop': [{'item': 'bread'}]} for r in plan['npcs']] + [{'key': 'Other', 'carrier': 'base_villager'}]}
        tool.validate_plan(plan, profiles)
        facts = {r['key']: {'position': r['lastKnownPosition'], 'observedAt': 10} for r in plan['npcs']}
        merged = tool.merged_profiles(profiles, plan['npcs'], facts)
        self.assertEqual(profiles['villagers'][0]['carrier'], 'base_villager')
        self.assertEqual(merged['villagers'][-1], profiles['villagers'][-1])
        for before, after in zip(profiles['villagers'][:-1], merged['villagers'][:-1]):
            self.assertEqual({k:v for k,v in after.items() if k not in ('carrier','entityBinding')},
                             {k:v for k,v in before.items() if k != 'carrier'})
        self.assertEqual(tool.merged_profiles(merged, plan['npcs'], facts), merged)
        with self.assertRaises(ValueError): tool.validate_plan(plan | {'npcs': plan['npcs'][:-1]}, profiles)


if __name__ == '__main__':
    unittest.main()
