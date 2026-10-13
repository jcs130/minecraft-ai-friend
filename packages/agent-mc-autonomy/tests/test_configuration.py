import hashlib
import json

import pytest

from agent_mc_autonomy.configuration import Settings
from agent_mc_autonomy.core_distribution import install as installer


def test_remote_server_and_separate_viewer(tmp_path):
    settings = Settings.parse({"server": {"host": "play.example.org", "username": "Alice", "version": "1.21.1"},
                               "viewer": {"url": "https://viewer.example.org/dungeon/"}})
    config = settings.client_config(tmp_path)
    assert config["world"]["host"] == "play.example.org"
    assert config["world"]["username"] == "Alice"
    assert config["world"]["version"] == "1.21.1"
    assert config["world"]["viewerPort"] == config["consolePort"] == 0
    assert config["world"]["performanceBridge"] == {"module": "", "endpoint": ""}
    assert config["world"]["local"] == {"startWithWorld": False, "serverDir": "", "cheats": False}
    assert not config["world"]["client"]["enabled"]
    assert settings.external_viewer_url.startswith("https://viewer.")
    assert settings.identity != Settings.parse({"server": {"host": "other.example.org", "username": "Alice"}}).identity


@pytest.mark.parametrize("config", [
    {"server": {"host": "http://example.org"}}, {"server": {"port": True}},
    {"server": {"port": 65536}}, {"server": {"username": "bad name"}},
    {"server": {"auth": "bypass"}}, {"autonomy": {"enabled": "false"}},
    {"viewer": {"url": "https://user:secret@viewer.example.org/"}},
    {"viewer": {"url": "javascript:alert(1)"}},
    {"server": {"version": "auto"}}, {"server": {"version": "1.20.6"}},
    {"viewer": {"port": 3000}}, {"viewer": {"console_port": 3001}},
])
def test_invalid_settings_are_rejected(config):
    with pytest.raises(ValueError):
        Settings.parse(config)


def test_no_server_default_and_microsoft_identity():
    with pytest.raises(ValueError, match="server_not_configured"):
        Settings.parse({}).require_server()
    settings = Settings.parse({"server": {"auth": "microsoft", "username": "private-account-label"}})
    assert settings.auth == "microsoft"


def test_unverified_archive_and_missing_runtime_are_rejected(tmp_path):
    archive = tmp_path / "untrusted.tgz"
    archive.write_bytes(b"not the pinned release")
    with pytest.raises(ValueError, match="hash_mismatch"):
        installer.verify_archive(archive)
    with pytest.raises(ValueError, match="backend_missing"):
        installer.verify_runtime(tmp_path)


def test_upgrade_does_not_change_account_ledger(tmp_path):
    import dataclasses
    settings = Settings.parse({"server": {"host": "play.example.org", "username": "Alice"}})
    upgraded = dataclasses.replace(settings, backend_directory=str(tmp_path / "new-runtime"))
    assert upgraded.client_config(tmp_path)["dataDir"] == settings.client_config(tmp_path)["dataDir"]


def test_runtime_requires_cleanup_patch_and_untampered_compiled_files(tmp_path):
    root = tmp_path / "node_modules/agent-mc-world"
    (root / "bin").mkdir(parents=True)
    (root / "bin/minecraft-agent-mcp.mjs").write_text("// fixture", encoding="utf-8")
    (root / "dist").mkdir()
    code = root / "dist/runtime.js"
    code.write_bytes(b"export const example = 1;")
    pin = installer.SOURCE
    package = {"name": pin["name"], "version": pin["version"], "nekoBuild": {
        "profile": "headless", "sourceRevision": pin["source_revision"]}}
    manifest = root / "package.json"
    manifest.write_text(json.dumps(package), encoding="utf-8")
    with pytest.raises(ValueError, match="backend_build_mismatch"):
        installer.verify_runtime(tmp_path)
    package["nekoBuild"]["patches"] = pin["patches"]
    manifest.write_text(json.dumps(package), encoding="utf-8")
    receipt = {"sourceRevision": pin["source_revision"], "bundledViewer": False, "patches": pin["patches"],
               "files": [{"file": "dist/runtime.js", "sha256": hashlib.sha256(code.read_bytes()).hexdigest()}]}
    (root / "dist/neko-headless.json").write_text(json.dumps(receipt), encoding="utf-8")
    assert installer.verify_runtime(tmp_path).is_file()
    code.write_bytes(b"tampered")
    with pytest.raises(ValueError, match="backend_build_mismatch"):
        installer.verify_runtime(tmp_path)
