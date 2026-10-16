"""The companion npm project must install the exact source receipt's archive."""

import base64
import json

from agent_mc_autonomy.core_distribution.install import SOURCE, SOURCE_DIR


def test_companion_lock_matches_exact_engine_receipt():
    package = json.loads((SOURCE_DIR / "package.json").read_text(encoding="utf-8"))
    lock = json.loads((SOURCE_DIR / "package-lock.json").read_text(encoding="utf-8"))
    reference = "file:" + SOURCE["archive"]
    assert package["dependencies"][SOURCE["name"]] == reference
    assert lock["packages"][""]["dependencies"] == package["dependencies"]
    installed = lock["packages"]["node_modules/" + SOURCE["name"]]
    assert installed["version"] == SOURCE["version"]
    assert installed["resolved"] == reference
    algorithm, digest = installed["integrity"].split("-", 1)
    assert algorithm == "sha512" and len(base64.b64decode(digest, validate=True)) == 64
    assert SOURCE["build_profile"] == "canonical-engine-only"
    assert SOURCE["upstream_release"] is False
    assert SOURCE["viewer_assets"] is None
    assert SOURCE["external_viewer"]["bundled_in_core"] is False
