import hashlib
import json

import pytest

from agent_mc_autonomy.configuration import Settings
from agent_mc_autonomy.core_distribution import install as installer


def test_context_default_matches_parsed_and_public_example():
    import tomllib
    from pathlib import Path

    example = tomllib.loads((Path(__file__).resolve().parents[1] / "standalone.example.toml").read_text(encoding="utf-8"))
    assert Settings().context_tokens == Settings.parse({}).context_tokens == 65536
    assert Settings.parse(example).context_tokens == 65536


@pytest.mark.parametrize("limit", [4096, 32768, 98304, 131072, 2097152])
def test_explicit_context_limit_is_preserved(limit):
    import dataclasses

    settings = Settings.parse({"autonomy": {"context_tokens": limit}})
    assert settings.context_tokens == limit
    assert Settings.parse({"autonomy": {"context_tokens": dataclasses.asdict(settings)["context_tokens"]}}).context_tokens == limit


@pytest.mark.parametrize("memory", [{}, {"read_preference": "balanced"}])
def test_default_memory_preference_keeps_existing_strict_body_config_compatible(tmp_path, memory):
    settings = Settings.parse({"server": {"host": "fixture.test", "username": "Alice"}, "memory": memory})
    forwarded = settings.client_config(tmp_path)["world"]["memory"]
    # The deployed 0.4 body rejects keys absent from its own configuration.
    # New bodies already default to balanced when this optional hint is omitted.
    known = {"mode", "endpoint", "model", "apiKeyEnv", "timeoutMs", "provider", "libraryId",
             "projectId", "scopeId", "searchMode", "learningEnabled"}
    assert set(forwarded) <= known


def test_remote_server_and_separate_viewer(tmp_path):
    settings = Settings.parse({"server": {"host": "play.example.org", "username": "Alice", "version": "1.21.1"},
                               "viewer": {"url": "https://viewer.example.org/3dview/"}})
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


def test_explicit_optional_bundled_viewer_catalog_is_not_part_of_account_or_body_config(tmp_path):
    base = {"server": {"host": "fixture.test", "username": "Alice"}}
    settings = Settings.parse({**base, "viewer": {"bundled_appearance_catalog_file": "C:/plugin/assets/appearances/catalog.json"}})
    default = Settings.parse(base)
    assert default.viewer_bundled_appearance_catalog_file == ""
    assert settings.viewer_bundled_appearance_catalog_file.endswith("catalog.json")
    assert settings.identity == default.identity
    assert settings.client_config(tmp_path) == default.client_config(tmp_path)


def test_optional_server_presentation_is_default_off_and_not_a_body_dependency(tmp_path):
    base = {"server": {"host": "fixture.test", "username": "Alice"}}
    default = Settings.parse(base)
    settings = Settings.parse({**base, "server_extension": {
        "presentation_module": "C:/packs/example/presentation.mjs", "presentation_sha256": "a" * 64}})
    assert default.server_presentation_module == default.server_presentation_sha256 == ""
    assert settings.server_presentation_module.endswith("presentation.mjs")
    assert settings.identity == default.identity
    assert settings.client_config(tmp_path) == default.client_config(tmp_path)
    assert not settings.enabled


@pytest.mark.parametrize("port", [
    {"presentation_module": "C:/port.mjs"}, {"presentation_sha256": "a" * 64},
    {"presentation_module": "https://example.invalid/port.mjs", "presentation_sha256": "a" * 64},
    {"presentation_module": "C:/port.py", "presentation_sha256": "a" * 64},
    {"presentation_module": "C:/port.mjs", "presentation_sha256": "bad"},
    {"channel": "server-specific"},
])
def test_unbound_or_implicit_server_presentation_is_rejected(port):
    with pytest.raises(ValueError):
        Settings.parse({"server_extension": port})


@pytest.mark.parametrize("appearance", ["server", "bundled:yui-ysm", "native:misc/3_default_boy:red"])
def test_local_viewer_default_preserves_account_body_and_disabled_start(tmp_path, appearance):
    base = {"server": {"host": "fixture.test", "username": "Alice"}}
    default = Settings.parse(base)
    settings = Settings.parse({**base, "viewer": {"default_appearance": appearance}})
    assert default.viewer_default_appearance == "server"
    assert settings.viewer_default_appearance == appearance
    assert settings.identity == default.identity
    assert settings.client_config(tmp_path) == default.client_config(tmp_path)
    assert settings.enabled is False


@pytest.mark.parametrize("appearance", ["", "server\n", "bundled:<script>", "server\"", "a" * 129, None])
def test_invalid_local_viewer_default_is_rejected(appearance):
    with pytest.raises(ValueError):
        Settings.parse({"viewer": {"default_appearance": appearance}})


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


@pytest.mark.parametrize("tampered", ["package.json", "dist/build.json", "dist/runtime.js", "dist/types/public.d.ts", "bin/minecraft-agent-mcp.mjs"])
def test_runtime_requires_pinned_receipts_and_untampered_files(tmp_path, monkeypatch, tampered):
    root = tmp_path / "node_modules/agent-mc-world"
    (root / "bin").mkdir(parents=True)
    (root / "bin/minecraft-agent-mcp.mjs").write_text("// fixture", encoding="utf-8")
    (root / "dist").mkdir()
    code = root / "dist/runtime.js"
    code.write_bytes(b"export const example = 1;")
    pin = installer.SOURCE.copy()
    package = {"name": pin["name"], "version": pin["version"]}
    manifest = root / "package.json"
    manifest.write_text(json.dumps(package), encoding="utf-8")
    receipt = {"schema": "agent-mc-build/v1", "viewer": {"included": False}, "sourceFiles": [],
               "files": [{"file": "dist/runtime.js", "sha256": hashlib.sha256(code.read_bytes()).hexdigest()}]}
    (root / "dist/build.json").write_text(json.dumps(receipt), encoding="utf-8")
    (root / "dist/types").mkdir()
    declaration = root / "dist/types/public.d.ts"
    declaration.write_bytes(b"export declare const example: number;")
    (root / "dist/types/manifest.json").write_text(json.dumps({"files": [
        {"file": "public.d.ts", "sha256": hashlib.sha256(declaration.read_bytes()).hexdigest()}]}), encoding="utf-8")
    pin["verification"] = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in (
        "package.json", "dist/build.json", "dist/types/manifest.json", "bin/minecraft-agent-mcp.mjs")}
    monkeypatch.setattr(installer, "SOURCE", pin)
    assert installer.verify_runtime(tmp_path).is_file()
    (root / tampered).write_bytes(b"tampered")
    with pytest.raises(ValueError, match="backend_build_mismatch"):
        installer.verify_runtime(tmp_path)


def test_game_memory_config_and_credentials_are_forwarded_without_personal_memory(tmp_path, monkeypatch):
    monkeypatch.setenv("MC_MEMORY_KEY", "private-fixture-key")
    monkeypatch.setenv("UNRELATED_MODEL_KEY", "do-not-forward")
    settings = Settings.parse({"server": {"host": "fixture.test", "username": "Alice"}, "memory": {
        "mode": "remote", "provider": "powercontext", "endpoint": "https://memory.example.org", "scope_id": "game-scope",
        "api_key_env": "MC_MEMORY_KEY", "search_mode": "hybrid", "learning_enabled": True, "read_preference": "remote-first"}})
    assert settings.memory.environment() == {"MC_MEMORY_KEY": "private-fixture-key"}
    config = settings.client_config(tmp_path)
    assert config["world"]["memory"]["scopeId"] == "game-scope"
    assert config["world"]["memory"]["apiKeyEnv"] == "MC_MEMORY_KEY"
    assert config["world"]["memory"]["learningEnabled"] is True
    assert config["world"]["memory"]["readPreference"] == "remote-first"
    assert "private-fixture-key" not in json.dumps(config)
    assert "do-not-forward" not in json.dumps(config)
    assert Settings.parse({"memory": {"api_key_env": "MC_MEMORY_KEY"}}).memory.environment() == {}
    assert Settings.parse({}).memory.mode == "local"
    assert Settings.parse({}).memory.learning_enabled is False
    assert Settings.parse({}).memory.read_preference == "balanced"


@pytest.mark.parametrize("memory", [
    {"mode": "vector"}, {"mode": "vector", "endpoint": "https://embedding.example.org"},
    {"mode": "remote", "endpoint": "https://memory.example.org", "provider": "powercontext"},
    {"mode": "remote", "endpoint": "https://user:secret@memory.example.org"},
    {"api_key_env": "literal-secret-value"}, {"api_key": "literal-secret"}, {"timeout_ms": True},
    {"timeout_ms": 30001}, {"provider": "guessed-cloud"}, {"search_mode": "auto"},
    {"learning_enabled": True}, {"learning_enabled": "true"}, {"read_preference": "guessed"},
    {"mode": "remote", "provider": "bailian", "endpoint": "https://memory.example.org", "learning_enabled": True},
])
def test_invalid_memory_configuration_is_rejected(memory):
    with pytest.raises(ValueError):
        Settings.parse({"memory": memory})
