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
    (renderer / "tools").mkdir(parents=True)
    (renderer / "tools/native-world-preview-host.mjs").touch()
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


@pytest.mark.parametrize("fault,expected", [
    ("module", "renderer_missing"),
    ("catalog_missing", "catalog_invalid_or_missing"),
    ("catalog_invalid", "catalog_invalid_or_missing"),
    ("catalog_version", "catalog_version_missing_or_ambiguous"),
    ("native_version", "version_resources_invalid_or_missing"),
    ("registry", "version_resources_invalid_or_missing"),
])
def test_real_layout_preserves_metadata_rejection_boundaries(tmp_path, fault, expected):
    renderer, assets = tmp_path / "renderer", tmp_path / "assets"
    (renderer / "tools").mkdir(parents=True)
    module = renderer / "tools/native-world-preview-host.mjs"
    module.touch()
    assets.mkdir()
    native = {"schemaVersion": 1, "minecraftVersion": "1.21.1", "registryHashes": {"block-states.jsonl": "a" * 64}}
    pack = {"minecraftVersion": "1.21.1", "registry": "vanilla", "registrySha256": "a" * 64, "assetDirectory": "assets"}
    catalog = tmp_path / "catalog.json"
    if fault == "module":
        module.unlink()
    elif fault == "catalog_version":
        pack["minecraftVersion"] = "1.20.1"
    elif fault == "native_version":
        native["minecraftVersion"] = "1.20.1"
    elif fault == "registry":
        pack["registrySha256"] = "b" * 64
    (assets / "native-assets.json").write_text(json.dumps(native))
    (assets / "viewer-assets.json").write_text('{"minecraftVersion":"1.21.1"}')
    if fault != "catalog_missing":
        catalog.write_text("invalid" if fault == "catalog_invalid" else json.dumps({"schemaVersion": 1, "packs": [pack]}))
    settings = Settings.parse({"viewer": {"renderer_directory": str(renderer), "catalog_file": str(catalog)}})
    result = installation_readiness(settings, tmp_path)
    assert result["viewer"] == expected and result["scene_verified"] is False
    assert not (renderer / "host").exists()
