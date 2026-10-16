"""Recipient boundaries: no implicit mixing, no process, explicit full verification."""

import hashlib
import json
from pathlib import Path

import pytest

from agent_mc_autonomy import Settings
from agent_mc_autonomy.runtime_bundle import apply_runtime_defaults, resolve_prepared_bundle, verify_settings_runtime
from agent_mc_autonomy.runtime_bundle import manifest as m


@pytest.fixture
def bundle(tmp_path, monkeypatch):
    root = tmp_path / "bundle"
    root.mkdir()
    registry = b"fixture registry"
    registry_hash = hashlib.sha256(registry).hexdigest()
    node_hash = hashlib.sha256(b"node fixture").hexdigest()
    pin = {"version": "test", "source_revision": "a" * 40, "external_viewer": {
        "source_revision": "b" * 40, "source_receipt": {"sourceSha256": "c" * 64}},
        "offline_node": {"executable_sha256": node_hash}, "offline_resources": {},
        "offline_browser": {"executable_sha256": node_hash, "revision": "1243", "browserVersion": "153.0.8010.12"}}
    monkeypatch.setattr(m, "source_pin", lambda: pin)
    monkeypatch.setattr(m, "REGISTRY_SHA256", registry_hash)
    monkeypatch.setattr(m.sys, "platform", "win32")
    monkeypatch.setattr(m.platform, "machine", lambda: "AMD64")
    import agent_mc_autonomy.core_distribution.install as install
    monkeypatch.setattr(install, "verify_runtime", lambda path: None)
    resources = {"minecraftVersion": "1.21.1", "registrySha256": registry_hash, "assetDirectory": "assets",
                 "catalog": "viewer-catalog.json", "appearanceCatalog": "appearances/catalog.json"}
    catalog = {"schemaVersion": 1, "packs": [{"id": "vanilla-1.21.1", "minecraftVersion": "1.21.1", "registry": "vanilla",
               "registrySha256": registry_hash, "assetDirectory": "assets"}]}
    contents = {"node/node.exe": b"node fixture", "browser/browser.exe": b"node fixture", "browser/LICENSE": b"license", "backend/package.json": b"{}", "viewer/package.json": b"{}",
                "viewer/renderer-src/package.json": b"{}", "viewer-source.json": b"{}",
                "viewer/renderer-src/tools/native-world-preview-host.mjs": b"export {}", "viewer/src/adapter.ts": b"export {}", "assets/registry/block-states.jsonl": registry,
                "assets/public/sounds/manifest.json": b'{"fileMetadata":{}}', "appearances/catalog.json": b'{"assets":{}}', "prepare.cmd": b"echo fixture",
                "assets/native-assets.json": b'{"assets":{}}',
                "prepare.mjs": b"// fixture", "source.json": b"{}", "LICENSE": b"license", "large-resource.ogg": b"resource",
                "viewer-catalog.json": json.dumps(catalog).encode()}
    for name, data in contents.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    from agent_mc_autonomy.runtime_bundle import viewer_source
    expected = {name.removeprefix("viewer/"): {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                for name, data in contents.items() if name.startswith("viewer/")}
    monkeypatch.setattr(viewer_source, "pinned_viewer_files", lambda _: expected)
    pin["external_viewer"]["source_inventory"] = {"file": "viewer-source.json", "sha256": hashlib.sha256(b"{}").hexdigest(), "files": len(expected)}
    manifest = {"schema": m.SCHEMA, "id": "test-1", "platform": "win32", "architecture": "x64",
                "node": {"version": m.NODE_VERSION, "path": "node/node.exe", "sha256": node_hash},
                "browser": {"path": "browser/browser.exe", "license": "browser/LICENSE", "sha256": node_hash,
                            "revision": "1243", "version": "153.0.8010.12", "playwrightVersion": "1.63.0"},
                "core": {"version": "test", "sourceRevision": "a" * 40, "directory": "backend"},
                "viewer": {"sourceRevision": "b" * 40, "sourceSha256": "c" * 64, "directory": "viewer/renderer-src"},
                "resources": resources, "licenses": ["LICENSE"], "files": {
                    name: {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for name, data in contents.items()}}
    update(root, manifest)
    local = tmp_path / "local"
    local.mkdir()
    catalog["packs"][0]["assetDirectory"] = str((root / "assets").resolve())
    (local / "catalog.json").write_text(json.dumps(catalog))
    registration = {"schema": "agent-mc-runtime-registration/v1", "root": str(root),
                    "manifestSha256": m.digest(root / m.MANIFEST), "catalog": str(local / "catalog.json")}
    (local / "registration.json").write_text(json.dumps(registration))
    return root, manifest, local / "registration.json"


def update(root, manifest):
    (root / m.INVENTORY).write_text(json.dumps(manifest["files"]))
    descriptor = {key: value for key, value in manifest.items() if key != "files"}
    descriptor["inventory"] = {"path": m.INVENTORY, "sha256": m.digest(root / m.INVENTORY), "files": len(manifest["files"])}
    (root / m.MANIFEST).write_text(json.dumps(descriptor))


def test_complete_bundle_and_prepared_defaults(bundle):
    root, _, registration = bundle
    assert m.verify_bundle(root)["integrityVerified"] is True
    raw = {"server": {"host": "localhost", "username": "fixture"}}
    result = apply_runtime_defaults(raw, registration_file=registration)
    settings = Settings.parse(result)
    assert settings.node == str(root / "node/node.exe")
    assert settings.backend_directory == str(root / "backend")
    assert settings.enabled is False
    assert raw == {"server": {"host": "localhost", "username": "fixture"}}
    verify_settings_runtime(settings)


@pytest.mark.parametrize("raw", [
    {"backend": {"node": "custom-node"}}, {"backend": {"directory": "custom-core"}},
    {"viewer": {"renderer_directory": "custom-viewer"}}, {"viewer": {"catalog_file": "custom.json"}},
    {"viewer": {"bundled_appearance_catalog_file": "my-appearance.json"}}, {"viewer": {"url": "https://observer.invalid"}},
    {"runtime": {"mode": "external"}}, {"backend": {"provider": "java-client"}},
])
def test_custom_or_observer_does_not_read_registration(raw, monkeypatch):
    import agent_mc_autonomy.runtime_bundle as runtime
    monkeypatch.setattr(runtime, "resolve_prepared_bundle", lambda **kwargs: pytest.fail("implicit lookup"))
    assert apply_runtime_defaults(raw) == raw


def test_metadata_resolution_never_hashes_resource_bytes(bundle, monkeypatch):
    root, _, registration = bundle
    original = m.digest
    def metadata_only(path):
        assert path.name == m.MANIFEST
        return original(path)
    monkeypatch.setattr(m, "digest", metadata_only)
    original_read = m.read_json
    def bounded_metadata(path, *args):
        assert path.name != m.INVENTORY
        return original_read(path, *args)
    monkeypatch.setattr(m, "read_json", bounded_metadata)
    assert resolve_prepared_bundle(registration_file=registration).root == root


def test_damage_fails_at_explicit_start_not_metadata_readiness(bundle):
    root, _, registration = bundle
    raw = apply_runtime_defaults({}, registration_file=registration)
    (root / "large-resource.ogg").write_bytes(b"corrupt!")
    assert resolve_prepared_bundle(registration_file=registration).root == root
    with pytest.raises(m.BundleError, match="file_hash_mismatch"):
        verify_settings_runtime(Settings.parse(raw))


@pytest.mark.parametrize("name", ["../escape", "/absolute", "C:/absolute", "a\\b", "a/../b", "a//b", "NUL.txt", "a.", "a ", "a:stream"])
def test_windows_paths_rejected(bundle, name):
    root, manifest, _ = bundle
    manifest["files"][name] = {"bytes": 0, "sha256": "a" * 64}
    update(root, manifest)
    with pytest.raises(m.BundleError, match="path_invalid"):
        m.verify_bundle(root)


def test_case_collision_rejected(bundle):
    root, manifest, _ = bundle
    manifest["files"]["LICENSE".lower()] = manifest["files"]["LICENSE"]
    update(root, manifest)
    with pytest.raises(m.BundleError, match="collision"):
        m.verify_bundle(root)


@pytest.mark.parametrize("section,key,value", [("node", "version", "24.0.0"), ("core", "sourceRevision", "d" * 40),
    ("viewer", "sourceRevision", "d" * 40), ("viewer", "sourceSha256", "d" * 64), ("resources", "minecraftVersion", "1.20.6")])
def test_wrong_source_is_rejected(bundle, section, key, value):
    root, manifest, _ = bundle
    manifest[section][key] = value
    update(root, manifest)
    with pytest.raises(m.BundleError, match="source_mismatch"):
        m.verify_bundle(root, full=False)


def test_missing_required_file_and_unlisted_file(bundle):
    root, manifest, _ = bundle
    (root / "unexpected.mjs").write_text("bad")
    with pytest.raises(m.BundleError, match="unlisted_file"):
        m.verify_bundle(root)
    (root / "unexpected.mjs").unlink()
    (root / "node/node.exe").unlink()
    with pytest.raises(m.BundleError, match="input_missing"):
        m.verify_bundle(root, full=False)


def test_wrong_platform(bundle, monkeypatch):
    monkeypatch.setattr(m.sys, "platform", "linux")
    with pytest.raises(m.BundleError, match="platform_unsupported"):
        m.verify_bundle(bundle[0], full=False)


def test_manifest_and_catalog_tampering(bundle):
    root, manifest, registration = bundle
    manifest["id"] = "changed"
    update(root, manifest)
    with pytest.raises(m.BundleError, match="manifest_hash"):
        resolve_prepared_bundle(registration_file=registration)


def test_wrong_selected_root(bundle, tmp_path):
    with pytest.raises(m.BundleError, match="root_mismatch"):
        resolve_prepared_bundle(bundle_root=tmp_path / "other", registration_file=bundle[2])


def test_settings_parse_does_not_resolve_or_write(monkeypatch):
    monkeypatch.setattr(Path, "open", lambda *args, **kwargs: pytest.fail("parse must be pure"))
    assert not Settings.parse({"runtime": {"bundle_root": "missing"}}).enabled


def test_reparse_point_rejected(bundle, monkeypatch):
    root, _, _ = bundle
    original = Path.lstat
    class Reparse:
        st_mode = 0
        st_file_attributes = 0x400
    monkeypatch.setattr(Path, "lstat", lambda path: Reparse() if path == root / "node" else original(path))
    with pytest.raises(m.BundleError, match="link_forbidden"):
        m.verify_bundle(root, full=False)


def test_builder_rejects_existing_destination(tmp_path):
    from agent_mc_autonomy.runtime_bundle.build import build_bundle
    with pytest.raises(ValueError, match="must be new"):
        build_bundle(tmp_path, **{name + "_directory": tmp_path for name in ("node", "backend", "viewer", "assets", "appearances", "licenses", "browser")}, bundle_id="test")


def test_browser_environment_is_child_only_and_preserves_explicit_override(bundle, monkeypatch):
    root, _, registration = bundle
    monkeypatch.delenv("AGENT_MC_BROWSER_EXECUTABLE", raising=False)
    settings = Settings.parse(apply_runtime_defaults({}, registration_file=registration))
    assert verify_settings_runtime(settings) == {"AGENT_MC_BROWSER_EXECUTABLE": str(root / "browser/browser.exe")}
    import os
    assert "AGENT_MC_BROWSER_EXECUTABLE" not in os.environ
    monkeypatch.setenv("AGENT_MC_BROWSER_EXECUTABLE", "custom-browser.exe")
    assert verify_settings_runtime(settings) == {"AGENT_MC_BROWSER_EXECUTABLE": "custom-browser.exe"}
    assert os.environ["AGENT_MC_BROWSER_EXECUTABLE"] == "custom-browser.exe"


def test_resolved_config_roundtrip_retains_binding_and_start_verification(bundle):
    root, _, registration = bundle
    effective = apply_runtime_defaults({}, registration_file=registration)
    saved = json.loads(json.dumps(effective))
    again = apply_runtime_defaults(saved, registration_file=registration)
    assert again == effective
    settings = Settings.parse(again)
    assert settings.bundle_root == str(root)
    assert verify_settings_runtime(settings)["AGENT_MC_BROWSER_EXECUTABLE"]
    (root / "large-resource.ogg").write_bytes(b"corrupt!")
    with pytest.raises(m.BundleError, match="file_hash_mismatch"):
        verify_settings_runtime(Settings.parse(apply_runtime_defaults(saved)))


def test_changed_component_cannot_reuse_existing_bundle_binding(bundle):
    effective = apply_runtime_defaults({}, registration_file=bundle[2])
    effective["backend"]["node"] = "unrelated-node"
    settings = Settings.parse(apply_runtime_defaults(effective))
    with pytest.raises(m.BundleError, match="component_mismatch"):
        verify_settings_runtime(settings)


def test_extracted_source_selects_cached_installation_by_identity(bundle, tmp_path, monkeypatch):
    import shutil
    root, manifest, registration = bundle
    source = tmp_path / "download"
    shutil.copytree(root, source)
    local = tmp_path / "local"
    selected = local / "AgentMCWorld/installations" / (manifest["id"] + "-" + m.digest(root / m.MANIFEST)) / "registration.json"
    selected.parent.mkdir(parents=True)
    shutil.copyfile(registration, selected)
    monkeypatch.setenv("LOCALAPPDATA", str(local))
    resolved = resolve_prepared_bundle(bundle_root=source)
    assert resolved.root == root
    # Removing only this test's extracted source cannot break the installed selection.
    shutil.rmtree(source)
    assert resolve_prepared_bundle(registration_file=selected).node == root / "node/node.exe"


def test_rehashed_wrong_viewer_source_cannot_claim_the_pin(bundle):
    root, manifest, _ = bundle
    name = "viewer/renderer-src/tools/native-world-preview-host.mjs"
    (root / name).write_bytes(b"export const unexpected = true;")
    manifest["files"][name] = {"bytes": (root / name).stat().st_size, "sha256": m.digest(root / name)}
    update(root, manifest)
    with pytest.raises(m.BundleError, match="viewer_source_mismatch"):
        m.verify_bundle(root)


def test_builder_rejects_wrong_viewer_before_creating_or_copying(bundle, tmp_path, monkeypatch):
    from agent_mc_autonomy.runtime_bundle import build
    root, _, _ = bundle
    destination = tmp_path / "new-output"
    monkeypatch.setattr(build, "copy_tree", lambda *args, **kwargs: pytest.fail("copy before source verification"))
    with pytest.raises(m.BundleError, match="viewer_source"):
        build.build_bundle(destination, **{name + "_directory": root for name in ("node", "backend", "viewer", "assets", "appearances", "licenses", "browser")}, bundle_id="wrong-viewer")
    assert not destination.exists()


@pytest.mark.parametrize("change", ["missing", "extra_renderer", "extra_adapter"])
def test_rehashed_viewer_source_fileset_must_be_exact(bundle, change):
    root, manifest, _ = bundle
    name = "viewer/src/adapter.ts" if change != "extra_renderer" else "viewer/renderer-src/extra.mjs"
    if change == "missing":
        (root / name).unlink()
        del manifest["files"][name]
    else:
        if change == "extra_adapter":
            name = "viewer/src/extra.ts"
        (root / name).write_bytes(b"export {}")
        manifest["files"][name] = {"bytes": 9, "sha256": m.digest(root / name)}
    update(root, manifest)
    with pytest.raises(m.BundleError, match="viewer_source_mismatch"):
        m.verify_bundle(root)
