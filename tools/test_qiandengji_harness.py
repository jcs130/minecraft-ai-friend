import json
import os
import tempfile
import tomllib
import unittest
from pathlib import Path
from unittest.mock import patch

from qiandengji_harness import HARNESS_IDS, main, select_harness


PROFILE = '''[runtime]
mode="external"
data_directory="C:/private/same-character"
[server]
host="server.example"
port=25565
username="ag_Test"
version="1.21.1"
[agent]
owner_id="owner"
id="stable-role"
name="旅人"
persona="保留过去的经历。"
[planner]
route="harnessrouter"
base_url="http://127.0.0.1:29150/api/harness"
harness_id="dsh"
model="qwen3.7-plus"
api_key_env="TEST_GATEWAY_KEY"
max_step=4
'''


class HarnessOperatorTests(unittest.TestCase):
    def test_every_verified_runtime_preserves_all_other_config_sections(self):
        with tempfile.TemporaryDirectory() as temporary:
            config = Path(temporary) / "character.toml"
            config.write_text(PROFILE, encoding="utf-8")
            original = tomllib.loads(PROFILE)
            for name in HARNESS_IDS:
                result = select_harness(config, name)
                current = tomllib.loads(config.read_text(encoding="utf-8"))
                self.assertEqual({k: v for k, v in original.items() if k != "planner"},
                                 {k: v for k, v in current.items() if k != "planner"})
                self.assertEqual(current["planner"]["harness_id"], name)
                self.assertTrue(result["account_binding_preserved"])
            self.assertEqual(len(list(Path(temporary).glob(".planner-*"))), 0)

    def test_protocol_alias_and_explicit_other_provider_model(self):
        with tempfile.TemporaryDirectory() as temporary:
            config = Path(temporary) / "character.toml"
            config.write_text(PROFILE, encoding="utf-8")
            self.assertEqual(select_harness(config, "codex")["model"], "qwen3.7-plus-responses")
            self.assertEqual(select_harness(config, "claude-code")["model"], "qwen3.7-plus-messages")
            self.assertEqual(select_harness(config, "pi", "operator-chosen-model")["model"], "operator-chosen-model")

    def test_unverified_runtime_or_ambiguous_table_leaves_original_untouched(self):
        for profile, runtime in [(PROFILE, "gemini"), (PROFILE + '[another]\nvalue=1\n', "pi"),
                                 (PROFILE.replace('route="harnessrouter"', 'route="direct"'), "pi")]:
            with self.subTest(runtime=runtime), tempfile.TemporaryDirectory() as temporary:
                config = Path(temporary) / "character.toml"
                config.write_text(profile, encoding="utf-8")
                with self.assertRaises(ValueError):
                    select_harness(config, runtime)
                self.assertEqual(config.read_text(encoding="utf-8"), profile)

    def test_launcher_uses_original_framework_and_restores_private_key_environment(self):
        with tempfile.TemporaryDirectory() as temporary:
            config, key = Path(temporary) / "character.toml", Path(temporary) / "key.json"
            config.write_text(PROFILE, encoding="utf-8")
            key.write_text(json.dumps({"key": "offline-test-key-with-enough-characters"}), encoding="utf-8")
            with patch.dict(os.environ, {"TEST_GATEWAY_KEY": "previous-value"}), patch("agent_mc_autonomy.cli.main") as call:
                call.side_effect = lambda argv: 0 if os.environ["TEST_GATEWAY_KEY"] == "offline-test-key-with-enough-characters" else 1
                self.assertEqual(main(["harness-check", "--config", str(config), "--key-file", str(key)]), 0)
                self.assertEqual(call.call_args.args[0], ["harness-check", "--config", str(config)])
                self.assertEqual(os.environ["TEST_GATEWAY_KEY"], "previous-value")

    def test_private_key_environment_is_restored_if_framework_fails(self):
        with tempfile.TemporaryDirectory() as temporary:
            config, key = Path(temporary) / "character.toml", Path(temporary) / "key.json"
            config.write_text(PROFILE, encoding="utf-8")
            key.write_text(json.dumps({"key": "offline-test-key-with-enough-characters"}), encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True), patch("agent_mc_autonomy.cli.main", side_effect=RuntimeError("test")):
                with self.assertRaises(RuntimeError):
                    main(["harness-check", "--config", str(config), "--key-file", str(key)])
                self.assertNotIn("TEST_GATEWAY_KEY", os.environ)


if __name__ == "__main__":
    unittest.main()
