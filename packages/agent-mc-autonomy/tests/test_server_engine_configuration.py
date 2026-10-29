from pathlib import Path

import pytest

from agent_mc_autonomy.configuration import Settings, SettingsValidationError


def test_server_engine_is_an_explicit_paired_local_port(tmp_path: Path):
    module = str(tmp_path / "engine.js")
    settings = Settings.parse({"server_extension": {"engine_module": module, "engine_sha256": "a" * 64}})
    assert settings.server_engine_module == module
    assert settings.server_engine_sha256 == "a" * 64
    assert not settings.enabled
    assert not Settings.parse({}).server_engine_module


@pytest.mark.parametrize("port", [
    {"engine_module": "https://example.com/engine.js", "engine_sha256": "a" * 64},
    {"engine_module": "relative.js", "engine_sha256": "a" * 64},
    {"engine_module": "/engine.js"},
    {"engine_sha256": "a" * 64},
    {"engine_module": "/engine.js", "engine_sha256": "not-a-hash"},
])
def test_invalid_server_engine_never_selects_a_backend(port):
    with pytest.raises(SettingsValidationError):
        Settings.parse({"server_extension": port})


def test_legacy_forge_requires_a_fully_bound_explicit_engine(tmp_path):
    port = {"engine_module": str(tmp_path / "engine.mjs"), "engine_sha256": "a" * 64}
    settings = Settings.parse({"server": {"version": "1.20.1", "username": "Fixture", "host": "fixture.invalid"},
                               "server_extension": port})
    assert settings.version == settings.client_config(tmp_path)["world"]["version"] == "1.20.1"
    assert not settings.enabled
    for invalid in [{}, {"engine_module": port["engine_module"]},
                    {"engine_module": "https://invalid/engine.mjs", "engine_sha256": "a" * 64},
                    {"engine_module": port["engine_module"], "engine_sha256": "bad"}]:
        with pytest.raises(SettingsValidationError):
            Settings.parse({"server": {"version": "1.20.1"}, "server_extension": invalid})
    with pytest.raises(SettingsValidationError):
        Settings.parse({"server": {"version": "1.19.4"}, "server_extension": port})
