"""The auth peer copies content mods, never unreviewed server-only wrappers."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("native_auth_builder", Path(__file__).with_name("build-native-auth.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class AuthenticationInputsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.server = Path(self.directory.name)
        self.mods = self.server / "mods"
        self.mods.mkdir()
        self.names = ["qiandengji-native-platform-0.1.4.jar", "touhoulittlemaid-1.5.3-qiandengji.jar", "ysm-2.6.5-neoforge+mc1.21.1-release.jar"]
        for name in self.names:
            (self.mods / name).write_bytes(name.encode())

    def test_existing_three_content_mods_are_unchanged(self):
        self.assertEqual([p.name for p in builder.authentication_content_mods(self.server)], sorted(self.names))

    def test_optional_artifact_has_the_reviewed_official_pin(self):
        self.assertEqual(builder.OPTIONAL_SERVER_ONLY_MODS, {
            "proxy-compatible-forge-1.3.1.jar": "dba5b70fedcb0f5fdc014801ab43e6d048f24b531de8aea5b70ea223760b66ae9fba3033c2ccd9d78793b9ea2f9d3b47ae1f4caa95aa129d989f97e63636b4ab"
        })

    def test_verified_optional_wrapper_is_excluded_from_auth_content(self):
        payload = b"isolated-selector-fixture"
        name = "proxy-compatible-forge-1.3.1.jar"
        (self.mods / name).write_bytes(payload)
        with patch.dict(builder.OPTIONAL_SERVER_ONLY_MODS, {name: hashlib.sha512(payload).hexdigest()}):
            self.assertEqual([p.name for p in builder.authentication_content_mods(self.server)], sorted(self.names))

    def test_modified_wrapper_is_rejected(self):
        (self.mods / "proxy-compatible-forge-1.3.1.jar").write_bytes(b"modified")
        with self.assertRaisesRegex(ValueError, "Unreviewed"):
            builder.authentication_content_mods(self.server)

    def test_unknown_mod_or_version_requires_review(self):
        for name in ["unexpected.jar", "proxy-compatible-forge-1.3.2.jar"]:
            path = self.mods / name
            path.write_bytes(b"unknown")
            with self.assertRaisesRegex(ValueError, "Review the current"):
                builder.authentication_content_mods(self.server)
            path.unlink()

    def test_missing_content_mod_is_rejected_even_with_known_wrapper(self):
        (self.mods / self.names[0]).unlink()
        with self.assertRaisesRegex(ValueError, "Review the current"):
            builder.authentication_content_mods(self.server)


if __name__ == "__main__":
    unittest.main()
