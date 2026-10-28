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
