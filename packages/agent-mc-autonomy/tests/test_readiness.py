import json

import pytest

from agent_mc_autonomy.configuration import Settings
from agent_mc_autonomy.readiness import installation_readiness, validation_feedback


@pytest.mark.parametrize("raw,field,code", [
    ({"server": {"host": "secret.invalid", "connection_type": "local"}}, "server.connection_type", "connection_type_mismatch"),
    ({"server": {"username": "SECRET!"}}, "server.username", "invalid_username"),
    ({"server": {"version": "secret"}}, "server.version", "unsupported_version"),
    ({"server": {"port": 0}}, "server.port", "invalid_integer_range"),
    ({"operator": {"port": 80}}, "operator.port", "operator_port_unprivileged"),
    ({"operator": {"port": "SECRET"}}, "operator.port", "invalid_integer_range"),
    ({"backend": {"directory": "SECRET "}}, "backend.directory", "invalid_text"),
    ({"viewer": {"renderer_directory": "SECRET"}}, "viewer.renderer_directory", "renderer_catalog_pair_required"),
])
def test_validation_safe_fields(raw, field, code):
    with pytest.raises(ValueError) as caught:
        Settings.parse(raw)
    feedback = validation_feedback(caught.value)
    assert feedback["field"] == field and feedback["code"] == code
    assert "SECRET" not in json.dumps(feedback)


def test_unknown_exception_never_echoes():
    assert "SECRET" not in json.dumps(validation_feedback(ValueError("SECRET")))


def test_default_text_only_and_no_writes(tmp_path):
    state = installation_readiness(Settings(), tmp_path)
    assert state["viewer"] == "text_only" and not state["scene_verified"]
    assert not list(tmp_path.iterdir())


def test_metadata_only_bounded_valid_large_manifest(tmp_path):
    renderer = tmp_path / "renderer"
    (renderer / "host").mkdir(parents=True)
    (renderer / "host/native-world-preview-host.mjs").touch()
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "native-assets.json").write_text(json.dumps({"schemaVersion": 1, "minecraftVersion": "1.21.1", "registryHashes": {"block-states.jsonl": "a" * 64}, "padding": "x" * 2200000}))
    (assets / "viewer-assets.json").write_text('{"minecraftVersion":"1.21.1"}')
    catalog = tmp_path / "catalog.json"
    catalog.write_text(json.dumps({"schemaVersion": 1, "packs": [{"minecraftVersion": "1.21.1", "registry": "vanilla", "registrySha256": "a" * 64, "assetDirectory": "assets"}]}))
    settings = Settings.parse({"viewer": {"renderer_directory": str(renderer), "catalog_file": str(catalog)}})
    assert installation_readiness(settings, tmp_path)["viewer"] == "metadata_matches_ready_to_attempt_rendering"
    catalog.write_text('{"SECRET":' + 'x' * 70000)
    result = installation_readiness(settings, tmp_path)
    assert result["viewer"] == "catalog_invalid_or_missing"
    assert "SECRET" not in json.dumps(result)
    catalog.write_text('[' * 2000)
    assert installation_readiness(settings, tmp_path)["viewer"] == "catalog_invalid_or_missing"
