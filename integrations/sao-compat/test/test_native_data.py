import contextlib,io,json,tempfile,unittest
from pathlib import Path
import sys
HERE=Path(__file__).resolve().parents[1];sys.path.insert(0,str(HERE))
from generate_native_addon import generate
from prepare_native_data import patch_native
from build_sao_contract import CONTRACT

class NativeDataContract(unittest.TestCase):
    def test_fresh_generation_has_actual_recipe_and_menu_bindings(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);(root/'pack-source.json').write_text('{"scope":"isolated_testing"}',encoding='utf-8')
            with contextlib.redirect_stdout(io.StringIO()):generate(root)
            build=root/'native-addon-build';java=build/'src/main/java/dev/qiandeng/maw/saoforge'
            self.assertTrue((java/'SaoRecipes.java').is_file());self.assertTrue((java/'mixins/RecipeManagerMixin.java').is_file())
            mixins=json.loads((build/'src/main/resources/maw_sao_recipes.mixins.json').read_bytes())
            self.assertIn('KubeRecipeDecodeMixin',mixins['server']);self.assertIn('KubeRecipeReloadMixin',mixins['server'])
            self.assertTrue((java/'mixins/KubeRecipeDecodeMixin.java').is_file())
            self.assertIn('case "recipes" -> {SaoRecipes.query(p,args,out);}',(java/'NativeBridge.java').read_text(encoding='utf-8'))
            self.assertIn('MenuFacts.slot(p,m,s,row)',(java/'NativeBridge.java').read_text(encoding='utf-8'))
            self.assertIn('p.closeContainer();p.inventoryMenu.broadcastFullState();',(java/'NativeBridge.java').read_text(encoding='utf-8'))
            native=json.loads((build/'src/main/resources/native-operations.json').read_bytes())
            a=next(op for op in native['operations'] if op['id']=='native.recipes')
            b=next(op for op in CONTRACT['operations'] if op['id']=='sao.recipes')
            self.assertEqual(a['parameters'],b['parameters'])
            self.assertEqual(a['example'],b['example'])
            self.assertEqual(json.loads((root/'native-generation.json').read_bytes())['recipe_provider'],True)
    def test_unreviewed_or_unprotected_old_source_does_not_get_a_silent_auth_upgrade(self):
        for text in ['', 'private static boolean recipeAvailable(){return false;}', 'return SaoAuthentication.loggedIn(p);']:
            with self.assertRaisesRegex(ValueError,'authentication_binding'):patch_native(text)

if __name__=='__main__':unittest.main()
