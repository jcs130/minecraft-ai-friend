import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from localize import deterministic_zip, scan_archive, updated_options
from quest_localization import add_chinese, transform, typed_names
from translate_missing import needs_translation, tokens, validate
from collections import defaultdict


class ChineseLocalizationTests(unittest.TestCase):
    def test_real_placeholders_and_ids_survive_translation(self):
        source = "§6%s: %1$d/%2$d, %.2f minecraft:stone /quest claim {name}"
        result = "§6%s：%1$d/%2$d，%.2f minecraft:stone /quest claim {name}"
        self.assertEqual(validate(source, result), result)
        with self.assertRaisesRegex(ValueError, "mismatch"):
            validate(source, result.replace("minecraft:stone", "minecraft:dirt"))

    def test_literal_percent_is_not_a_format_argument(self):
        self.assertEqual(tokens("Goods cost 5% less."), {})
        self.assertEqual(validate("Goods cost 5% less.", "商品价格降低 5%。"), "商品价格降低 5%。")
        self.assertEqual(tokens("Bonus: %d%%"), {"%d": 1, "%%": 1})

    def test_command_changes_and_lost_line_breaks_rejected(self):
        with self.assertRaisesRegex(ValueError, "mismatch"):
            validate("Use /quest claim now", "现在使用 /quest accept")
        with self.assertRaisesRegex(ValueError, "line_break"):
            validate("First\nSecond", "第一，第二")
        with self.assertRaisesRegex(ValueError, "mismatch"):
            validate("Run /npc for @initiator", "为 @npc 执行 /villager")
        self.assertEqual(validate("Player: %player%", "玩家：%player%"), "玩家：%player%")

    def test_key_names_brands_and_command_only_labels_keep_their_meaning(self):
        for source in ("Alt + %s", "Ctrl + %s", "RGB:", "UUID", "Cobblemon", "§6%s §7(%s) §8— /quest list %s"):
            self.assertFalse(needs_translation(source), source)
        self.assertTrue(needs_translation("Journal"))

    def test_zip_is_reproducible_and_contains_only_selected_translations(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {"assets/example/lang/zh_cn.json": json.dumps({"menu.title": "冒险日志"}, ensure_ascii=False).encode()}
            first = deterministic_zip(root / "one.zip", files)
            second = deterministic_zip(root / "two.zip", files)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with zipfile.ZipFile(first) as archive:
                self.assertEqual(archive.namelist(), list(files))
                self.assertEqual(json.loads(archive.read(next(iter(files))))["menu.title"], "冒险日志")

    def test_options_preserve_controls_and_other_packs_without_duplicates(self):
        before = 'lang:en_us\nresourcePacks:["vanilla","file/other.zip"]\nkey_key.forward:key.keyboard.w\n'
        after = updated_options(before)
        self.assertIn("lang:zh_cn", after)
        self.assertIn("key_key.forward:key.keyboard.w", after)
        self.assertIn('"file/other.zip"', after)
        self.assertEqual(updated_options(after), after)
        with self.assertRaisesRegex(ValueError, "malformed"):
            updated_options('resourcePacks:{"bad":true}')

    def test_quest_labels_cannot_change_objectives_rewards_ids_or_other_languages(self):
        original = {"title": {"en_us": "First", "de_de": "Erste"}, "description": "Do work", "requires": ["maw:one"],
                    "objectives": [{"type": "justquests:craft_item", "item": "minecraft:crafting_table", "count": 1}],
                    "rewards": [{"type": "justquests:xp", "amount": 5}], "repeatable": False}
        baseline = copy.deepcopy(original)
        result = add_chinese(original, "第一步", "完成工作")
        self.assertEqual(original, baseline)
        self.assertEqual(result["title"]["de_de"], "Erste")
        for key in ("requires", "objectives", "rewards", "repeatable"):
            self.assertEqual(result[key], original[key])
        self.assertEqual(result["description"], {"en_us": "Do work", "zh_cn": "完成工作"})

    def test_generator_transform_only_changes_text_leaves(self):
        source = {"count": 5, "enabled": True, "labels": ["A", "B"]}
        result = transform(source, {"labels/0": "甲", "labels/1": "乙"})
        self.assertEqual(result, {"count": 5, "enabled": True, "labels": ["甲", "乙"]})

    def test_live_rabbit_is_not_raw_meat_and_mining_shift_is_not_a_key(self):
        names = typed_names("minecraft:rabbit", {"item.minecraft.rabbit": "生兔肉", "entity.minecraft.rabbit": "兔子"})
        self.assertEqual(names["entity:minecraft:rabbit"], "兔子")
        self.assertEqual(names["item:minecraft:rabbit"], "生兔肉")
        self.assertTrue(needs_translation("{Name} Shift"))
        self.assertFalse(needs_translation("Shift + %s"))

    def test_conflicting_upstream_language_sources_are_not_silently_merged(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("assets/demo/lang/en_us.json", '{"title":"First"}')
        catalog = defaultdict(lambda: {"en_us": {"title": "Different"}, "zh_cn": {}, "origins": []})
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            scan_archive(io.BytesIO(buffer.getvalue()), "test.jar", catalog)


if __name__ == "__main__":
    unittest.main()
