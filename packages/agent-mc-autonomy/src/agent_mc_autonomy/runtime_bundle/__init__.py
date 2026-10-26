"""Explicit prepared-runtime defaults for any host; imports have no side effects."""

from __future__ import annotations

import copy
import os
from dataclasses import dataclass
from pathlib import Path

from ..filesystem import verification_path
from .manifest import BundleError, fail, read_json, verify_bundle


@dataclass(frozen=True)
class PreparedBundle:
    root: Path
    node: Path
    backend: Path
    renderer: Path
    catalog: Path
    appearances: Path
    manifest_sha256: str


def registration_path() -> Path:
    value = os.environ.get("LOCALAPPDATA")
    if not value:
        fail("localappdata_unavailable")
    return Path(value) / "AgentMCWorld/current.json"


def _require_prepared_catalog(root: Path, manifest: dict, catalog: dict) -> None:
    portable = read_json(root / manifest["resources"]["catalog"], 65536)
    assets = root / manifest["resources"]["assetDirectory"]
    # Node's installer keeps the logical LOCALAPPDATA spelling. In a packaged
    # Windows host Python may resolve that same directory into its app-data view.
    # Accept only these two spellings of the already-verified bundle member;
    # arbitrary aliases, foreign directories and other catalog changes still fail.
    for spelling in (str(assets), str(assets.resolve())):
        portable["packs"][0]["assetDirectory"] = spelling
        if catalog == portable:
            return
    fail("prepared_catalog_mismatch")


def resolve_prepared_bundle(*, bundle_root: Path | None = None, registration_file: Path | None = None,
                            verify_integrity: bool = False) -> PreparedBundle:
    """Read bounded registration/manifest metadata; full integrity is explicit at start."""
    selected = Path(registration_file) if registration_file else registration_path()
    selected_hash = None
    if bundle_root is not None and registration_file is None:
        metadata = verify_bundle(Path(bundle_root), full=False)
        selected_hash = metadata["manifestSha256"]
        installations = selected.parent / "installations"
        selected = installations / ("r-" + selected_hash[:32]) / "registration.json"
        # Previously prepared downloads remain usable. A present but invalid
        # short registration must fail instead of silently selecting another.
        if not verification_path(selected).exists():
            selected = installations / (metadata["id"] + "-" + selected_hash) / "registration.json"
    registration = read_json(selected, 65536)
    if registration.get("schema") != "agent-mc-runtime-registration/v1":
        fail("registration_invalid")
    try:
        root = Path(registration["root"])
        if (not root.is_absolute()
                or selected_hash is not None and registration["manifestSha256"] != selected_hash
                or registration_file is not None and bundle_root is not None and root.resolve() != Path(bundle_root).resolve()):
            fail("registration_root_mismatch")
        manifest = verify_bundle(root, expected_manifest_sha256=registration["manifestSha256"], full=verify_integrity)
        catalog_path = Path(registration["catalog"])
        catalog = read_json(catalog_path, 65536)
        _require_prepared_catalog(root, manifest, catalog)
        return PreparedBundle(root, root / manifest["node"]["path"], root / manifest["core"]["directory"],
                              root / manifest["viewer"]["directory"], catalog_path,
                              root / manifest["resources"]["appearanceCatalog"], manifest["manifestSha256"])
    except (KeyError, TypeError) as error:
        raise BundleError("runtime_bundle_registration_invalid: run prepare.cmd again") from error


def apply_runtime_defaults(raw: dict, *, bundle_root: Path | None = None, registration_file: Path | None = None) -> dict:
    """Apply one coherent prepared runtime only when no component was customized.

    Hosts explicitly call this at their configuration boundary and again before
    start. Settings.parse remains pure. No missing registration is guessed or
    downloaded. External observers and Java framebuffer configurations pass through.
    """
    result = copy.deepcopy(raw)
    backend, viewer, runtime = (result.get(k, {}) for k in ("backend", "viewer", "runtime"))
    if not all(isinstance(value, dict) for value in (backend, viewer, runtime)):
        return result  # Settings.parse owns ordinary configuration diagnostics.
    if (runtime.get("mode") == "external" or backend.get("provider") == "java-client"
            or any(backend.get(k) for k in ("directory", "node"))
            or any(viewer.get(k) for k in ("renderer_directory", "catalog_file", "bundled_appearance_catalog_file", "url"))):
        return result
    bundle = resolve_prepared_bundle(bundle_root=bundle_root, registration_file=registration_file)
    result.setdefault("backend", {}).update(node=str(bundle.node), directory=str(bundle.backend))
    result.setdefault("viewer", {}).update(renderer_directory=str(bundle.renderer), catalog_file=str(bundle.catalog),
                                            bundled_appearance_catalog_file=str(bundle.appearances))
    result.setdefault("runtime", {}).update(bundle_root=str(bundle.root), bundle_manifest_sha256=bundle.manifest_sha256)
    return result


def verify_settings_runtime(settings) -> dict[str, str]:
    """Explicit start guard: full bytes and selected component identity, no process/network."""
    if not settings.bundle_root:
        return {}
    root = Path(settings.bundle_root)
    manifest = verify_bundle(root, expected_manifest_sha256=settings.bundle_manifest_sha256)
    selected = [(settings.node, manifest["node"]["path"]), (settings.backend_directory, manifest["core"]["directory"]),
                (settings.viewer_renderer_directory, manifest["viewer"]["directory"]),
                (settings.viewer_bundled_appearance_catalog_file, manifest["resources"]["appearanceCatalog"])]
    if any(Path(value).resolve() != (root / name).resolve() for value, name in selected):
        fail("component_mismatch")
    catalog = read_json(Path(settings.viewer_catalog_file), 65536)
    _require_prepared_catalog(root, manifest, catalog)
    return {"AGENT_MC_BROWSER_EXECUTABLE": os.environ.get("AGENT_MC_BROWSER_EXECUTABLE", str(root / manifest["browser"]["path"]))}


__all__ = ["BundleError", "PreparedBundle", "apply_runtime_defaults", "resolve_prepared_bundle", "verify_bundle"]
