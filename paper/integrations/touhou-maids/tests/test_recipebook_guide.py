"""Offline source-safety contracts, not a replacement for initialized NeoForge QA."""
from pathlib import Path
import ast
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
GUIDE = ROOT / 'platform-src/local/tlmcompat/numen/RecipeBookGuide.java'
MIXIN = ROOT / 'platform-src/local/tlmcompat/numen/mixin/RecipeBookGuideInit.java'
BUILD = ROOT / 'build-recipebook-guide.py'


def code(path):
    text = path.read_text(encoding='utf8')
    return re.sub(r'//[^\n]*|/\*.*?\*/', '', text, flags=re.S)


class RecipeGuideSourceContracts(unittest.TestCase):
    def test_only_existing_known_recipe_operations(self):
        source = code(GUIDE)
        calls = set(re.findall(r'\bbook\.([A-Za-z]+)\(', source))
        self.assertEqual(calls, {'contains', 'add'})
        self.assertNotRegex(source, r'\b(?:addRecipes|removeRecipes|copyOverData|addHighlight|setOpen|setFiltering|awardRecipes|giveExperiencePoints)\s*\(')

    def test_duplicate_checks_and_actual_add_count(self):
        self.assertRegex(code(GUIDE), r'if\s*\(!book\.contains\(recipe\)\)\s*\{\s*book\.add\(recipe\);\s*if\s*\(book\.contains\(recipe\)\)\s*\{\s*added\+\+;')

    def test_native_channel_and_original_projection(self):
        source = code(GUIDE)
        self.assertIn('"touhou_little_maid", "maid_model"', source)
        self.assertRegex(source, r'if\s*\(!NetworkRegistry\.hasChannel\(player\.connection\.connection,\s*ConnectionProtocol\.PLAY,\s*MAID_MODEL_CHANNEL\)\)')
        self.assertIn('NativeClientRecipes.project(new ClientboundUpdateRecipesPacket(recipes)', source)
        self.assertIn('player.server.registryAccess()).getRecipes()', source)

    def test_original_initial_packet_is_not_cancelled_or_resent(self):
        source = code(MIXIN)
        self.assertIn('sendInitialRecipeBook(Lnet/minecraft/server/level/ServerPlayer;)V', source)
        self.assertIn('at = @At("HEAD")', source)
        self.assertIn('require = 1', source)
        self.assertNotRegex(source, r'\.\s*(?:cancel|send|sendInitialRecipeBook)\s*\(')
        self.assertNotIn('cancellable', source)
        self.assertEqual(source.count('RecipeBookGuide.populate('), 1)

    def test_no_player_inventory_mode_permission_or_advancement_mutation(self):
        source = code(GUIDE) + code(MIXIN)
        self.assertNotRegex(source, r'\b(?:getInventory|gameMode|setGameMode|setPermission|performCommand|dispatchCommand|getAdvancements|totalExperience|experienceLevel|experienceProgress)\b')

    def test_build_is_syntax_valid_and_production_overlay_is_bounded(self):
        ast.parse(BUILD.read_text(encoding='utf8'))
        source = BUILD.read_text(encoding='utf8')
        self.assertIn("CLASSES = [PREFIX + 'RecipeBookGuide.class', PREFIX + 'mixin/RecipeBookGuideInit.class']", source)
        self.assertIn("RESOURCES = ['qiandengji-native.mixins.json', 'META-INF/neoforge.mods.toml']", source)
        self.assertIn("assert sha(args.baseline) == BASE_SHA", source)
        self.assertIn("assert set(compiled) == set(CLASSES)", source)
        self.assertIn("assert jar.read(name) == original[name]", source)
        self.assertIn("'runtimeStateChecks': 'COMPILED_NOT_YET_RUN'", source)

    def test_qa_probe_is_separate_and_original_settings_tested(self):
        probe = (ROOT / 'tests/RecipeBookGuideQa.java').read_text(encoding='utf8')
        state = (ROOT / 'tests/RecipeBookGuideCheck.java').read_text(encoding='utf8')
        self.assertIn('@Mod("recipeguideqa")', probe)
        self.assertIn('ItemStack.matches', probe)
        self.assertIn('getBookSettings().equals(settings)', state)
        self.assertIn('!book.willHighlight(visible)', state)
        self.assertIn("probe = args.output / 'recipebook-qa-probe.jar'", BUILD.read_text(encoding='utf8'))


if __name__ == '__main__':
    unittest.main()
