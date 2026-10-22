"""Validate the optional module contract and shared-code extraction, without a game or credentials."""
import json,unittest
import build_numen_mods as build

class SharedMethodTests(unittest.TestCase):
    def test_extracts_nested_body_without_counting_strings_or_comments(self):
        source='''class X {
    static String select() {
        String s="{ escaped \\" }";
        /* } */ if (true) { // }
            return "}";
        }
        return "{";
    }
    static void other() {}
}'''
        actual=build.method(source,'select')
        self.assertIn('return "{";',actual);self.assertNotIn('other',actual)
    def test_missing_or_unbalanced_shared_method_is_a_build_failure(self):
        for source in ('class X {}','    static void select() { if (true) { }'):
            with self.assertRaises(ValueError):build.method(source,'select')
    def test_overloaded_call_inside_a_different_method_is_not_a_definition(self):
        source='    static void x() { select(); }\n    static void select() { }'
        self.assertEqual(build.method(source,'select'),'    static void select() { }')

class ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.contract=build.contracts();cls.rows={r['id']:r for r in cls.contract['operations']}
    def test_no_duplicate_operations_and_stable_serialization(self):
        self.assertEqual(len(self.rows),self.contract['operationCount'])
        self.assertEqual(json.dumps(self.contract,sort_keys=True),json.dumps(build.contracts(),sort_keys=True))
    def test_mod_actions_are_only_advertised_with_their_actual_dependency(self):
        for prefix,mod in [('colony.','minecolonies'),('domum.','domum_ornamentum'),('create.','create'),('curios.','curios'),('iron.','irons_spellbooks')]:
            rows=[r for id,r in self.rows.items() if id.startswith(prefix)];self.assertTrue(rows)
            self.assertTrue(all(r.get('requiredMod')==mod for r in rows))
    def test_menus_can_detect_full_component_or_cursor_drift(self):
        for id in ('menu.close','menu.button','menu.nativeClick'):
            shape=self.rows[id]['parameters'];self.assertIn('expectedControlHash',shape['properties'])
            self.assertIn('expectedStateId',shape['required']);self.assertFalse(shape['additionalProperties'])
    def test_mutations_and_queries_are_distinct(self):
        for id in ('colony.status','colony.resources','menu.snapshot','mods.list','iron.status'):
            self.assertTrue(self.rows[id]['readOnly'])
        for id in ('colony.found','colony.stockResource','domum.select','create.setValue','iron.cast'):
            self.assertFalse(self.rows[id]['readOnly'])
    def test_no_old_auth_rpg_or_operator_endpoints_are_transplanted(self):
        self.assertFalse(any(id.startswith(('auth.','rpg.','control.','society.','ysm.')) for id in self.rows))
        self.assertFalse(any('invocation' in r for r in self.rows.values()))
    def test_discovery_pagination_is_bounded(self):
        shape=self.rows['mods.list']['parameters'];self.assertEqual(shape['properties']['limit']['maximum'],24)
        self.assertFalse(shape['additionalProperties'])
    def test_colony_material_mutation_requires_identity_and_real_inventory(self):
        self.assertTrue({'buildingPosition','inventorySlot','expectedSnbt','quantity'}<=set(self.rows['colony.stockResource']['parameters']['required']))

class ReuseTests(unittest.TestCase):
    def test_shared_native_implementations_relocate_without_legacy_entrypoints(self):
        generated,paths=build.generated();self.assertTrue(paths)
        self.assertIn('building_storage_full',generated['PlayerColonyBridge.java'])
        self.assertIn('build_builder_hut_first',generated['PlayerColonyBridge.java'])
        self.assertIn('"outcomeKnown", false',generated['PlayerColonyBridge.java'])
        self.assertIn('WorldPermissions.check(player,p);',generated['MachineNative.java'])
        self.assertNotIn('com.minecolonies',generated['MachineNative.java'])
        self.assertNotIn('registerCommands',generated['IronsBody.java'])
        self.assertNotIn('openMenu(',generated['IronsBody.java'])
        for value in generated.values():self.assertTrue(value.startswith('package '+build.PACKAGE+';'))

if __name__=='__main__':unittest.main()
