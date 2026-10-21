"""Optional worker metadata regressions; no upstream install, model or game required."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("mc_harness_worker", Path(__file__).resolve().parents[1] / "bridges/harness2/worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class MethodGuidanceTests(unittest.TestCase):
    def test_description_is_agent_editable(self):
        text = "---\nname: minecraft-method\ndescription: Agent revised description\n---\nMeasured flat walking only."
        self.assertEqual(worker.method_guidance(text), "Measured flat walking only.")

    def test_crlf_and_reordered_fields(self):
        text = '---\r\ndescription: New purpose\r\nname: "minecraft-method"\r\n---\r\nRelease held keys.'
        self.assertEqual(worker.method_guidance(text), "Release held keys.")

    def test_wrong_identity_is_rejected(self):
        with self.assertRaises(ValueError):
            worker.method_guidance("---\nname: another-method\ndescription: Different identity\n---\nBody")

    def test_oversized_guidance_is_rejected(self):
        with self.assertRaises(ValueError):
            worker.method_guidance(worker.FRONT + "x" * 4001)


if __name__ == "__main__":
    unittest.main()
