"""Build refusal is read-only and must precede output or compiler construction."""
import importlib.util
import runpy
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


class FourPartyBuildTests(unittest.TestCase):
    def test_changed_base_is_rejected_without_output_or_compiler(self):
        spec = importlib.util.spec_from_file_location("four_party_build", ROOT / "build-four-player-party.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            inputs = {key: directory / (key + ".jar") for key in ("native", "bridge", "friend")}
            for file in inputs.values():
                file.write_bytes(b"deliberately unapproved fixture")
            before = {file: file.read_bytes() for file in inputs.values()}
            output = directory / "output"
            with patch.object(module.subprocess, "run", side_effect=AssertionError("must not compile")):
                with self.assertRaisesRegex(ValueError, "four_party_base_changed"):
                    module.build(directory, **inputs, jdk=directory / "jdk", output=output)
            self.assertFalse(output.exists())
            self.assertEqual(before, {file: file.read_bytes() for file in inputs.values()})

    def test_frozen_old_recipe_refuses_new_sources_before_reading_or_writing_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            arguments = [str(ROOT / "build-cooperative-exploration.py")]
            for key in ("server", "native-source", "jdk", "base-friend", "output"):
                arguments += ["--" + key, str(directory / key)]
            with patch.object(sys, "argv", arguments):
                with self.assertRaisesRegex(SystemExit, "Frozen cooperation source changed"):
                    runpy.run_path(str(ROOT / "build-cooperative-exploration.py"), run_name="__main__")
            self.assertEqual(list(directory.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
