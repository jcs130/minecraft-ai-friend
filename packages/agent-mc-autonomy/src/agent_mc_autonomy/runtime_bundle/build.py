"""Explicit distributor tooling. Recipient preparation needs only bundled Node."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import zipfile
from pathlib import Path

from .audio_profile import project_effects_audio, resource_profile
from .manifest import (
    INVENTORY,
    MANIFEST,
    NODE_VERSION,
    REGISTRY_SHA256,
    SCHEMA,
    digest,
    relative_path,
    source_pin,
    verify_bundle,
)
from .viewer_source import verify_viewer_input

HERE = Path(__file__).parent


def copy_tree(source: Path, destination: Path, *, exclude: frozenset[str] = frozenset(),
              exclude_prefixes: frozenset[str] = frozenset()) -> None:
    """Materialize regular files only. Links and author workspace mounts are rejected."""
    for directory, dirs, files in os.walk(source):
        for name in dirs + files:
            target = Path(directory) / name
            info = target.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
                raise ValueError("Source contains links; supply materialized runtime dependencies")
        dirs[:] = [name for name in dirs if (Path(directory) / name).relative_to(source).as_posix() + '/' not in exclude_prefixes]
        for name in files:
            target = Path(directory) / name
            relative = target.relative_to(source)
            if relative.as_posix() in exclude:
                continue
            relative_path(relative.as_posix())
            output = destination / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(target, output)


def build_bundle(destination: Path, *, node_directory: Path, backend_directory: Path,
                 viewer_directory: Path, assets_directory: Path, appearances_directory: Path,
                 licenses_directory: Path, browser_directory: Path, bundle_id: str,
                 compact_modern_viewer: bool = False, viewer_tools_directory: Path | None = None,
                 audio_profile: str = 'complete') -> Path:
    """Inputs are already installed exact runtime trees, never caches or developer junctions."""
    if destination.exists():
        raise ValueError("Bundle destination must be new; existing payloads are never replaced")
    pin = source_pin()
    sound_manifest = 'resources/vanilla-1.21.1/public/sounds/manifest.json'
    resource_pins, omitted_audio = resource_profile(pin, audio_profile, sound_manifest)
    projected_audio = None
    if audio_profile == 'effects-only':
        original = assets_directory / 'public/sounds/manifest.json'
        if digest(original) != pin['offline_resources'][sound_manifest]:
            raise ValueError('Original sound metadata does not match its fixed source')
        projected_audio, removed = project_effects_audio(original.read_bytes())
        if (hashlib.sha256(projected_audio).hexdigest() != resource_pins[sound_manifest]
                or tuple('resources/vanilla-1.21.1/public/sounds/' + name for name in removed) != omitted_audio):
            raise ValueError('Optional audio projection does not match its fixed source')
    verify_viewer_input(viewer_directory, pin)
    auxiliary = pin['external_viewer'].get('auxiliary_tools', {})
    for name, expected in auxiliary.items():
        relative_path(name)
        if (viewer_tools_directory is None or '/' in name
                or not (viewer_tools_directory / name).is_file()
                or (viewer_tools_directory / name).is_symlink()
                or digest(viewer_tools_directory / name) != expected):
            raise ValueError('Viewer auxiliary source input does not match its fixed Git receipt')
    destination.mkdir(parents=True)
    omitted = frozenset({pin["archive"], "node_modules/agent-mc-world/docs/research/vanilla-1.21.1-survival-foundations-20261016.md"})
    for source, name in [(backend_directory, "backend"), (viewer_directory, "viewer/modern-viewer"),
                         (assets_directory, "resources/vanilla-1.21.1"), (appearances_directory, "resources/appearances"),
                         (licenses_directory, "licenses"), (browser_directory, "browser")]:
        excludes = omitted if name == 'backend' else frozenset(
            path.removeprefix(name + '/') for path in omitted_audio) if name == 'resources/vanilla-1.21.1' else frozenset()
        copy_tree(source, destination / name, exclude=excludes,
                  exclude_prefixes=frozenset({'node_modules/prismarine-viewer/public/'})
                  if compact_modern_viewer and name == 'backend' else frozenset())
    if projected_audio is not None:
        (destination / sound_manifest).write_bytes(projected_audio)
    for name in auxiliary:
        (destination / 'tools').mkdir(exist_ok=True)
        shutil.copyfile(viewer_tools_directory / name, destination / 'tools' / name)
    (destination / "node").mkdir()
    for name in ("node.exe", "LICENSE", "README.md"):
        shutil.copyfile(node_directory / name, destination / "node" / name)
    for name in ("prepare.cmd", "prepare.mjs"):
        shutil.copyfile(HERE / name, destination / name)
    (destination / "source.json").write_text(json.dumps(pin, indent=2) + "\n", encoding="utf-8")
    shutil.copyfile(HERE.parent / "core_distribution/viewer-source.json", destination / "viewer-source.json")
    asset_directory = "resources/vanilla-1.21.1"
    catalog = {"schemaVersion": 1, "packs": [{"id": "vanilla-1.21.1", "minecraftVersion": "1.21.1", "registry": "vanilla",
                "registrySha256": REGISTRY_SHA256, "assetDirectory": asset_directory}]}
    (destination / "viewer-catalog.json").write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    manifest = {"schema": SCHEMA, "id": bundle_id, "platform": "win32", "architecture": "x64",
                "node": {"version": NODE_VERSION, "path": "node/node.exe", "sha256": digest(destination / "node/node.exe")},
                "browser": {"path": "browser/chrome-headless-shell-win64/chrome-headless-shell.exe", "license": "browser/chrome-headless-shell-win64/LICENSE.headless_shell",
                            "sha256": pin["offline_browser"]["executable_sha256"], "revision": pin["offline_browser"]["revision"],
                            "version": pin["offline_browser"]["browserVersion"], "playwrightVersion": "1.63.0"},
                "core": {"version": pin["version"], "sourceRevision": pin["source_revision"], "directory": "backend"},
                "viewer": {"sourceRevision": pin["external_viewer"]["source_revision"],
                           "sourceSha256": pin["external_viewer"]["source_receipt"]["sourceSha256"], "directory": "viewer/modern-viewer/renderer-src"},
                "resources": {"minecraftVersion": "1.21.1", "registrySha256": REGISTRY_SHA256, "assetDirectory": asset_directory,
                              "soundDirectory": asset_directory + "/public/sounds",
                              "catalog": "viewer-catalog.json", "appearanceCatalog": "resources/appearances/catalog.json"},
                "licenses": ["node/LICENSE", *sorted(p.relative_to(destination).as_posix() for p in (destination / "licenses").rglob("*") if p.is_file())],
                "excludedNonRuntimeFiles": {"backend/" + name: "Installer archive or optional research author-path note; no runtime/build receipt member removed" for name in sorted(omitted)},
                "audioProfile": audio_profile,
                "distributionProfile": "modern-viewer-only" if compact_modern_viewer else "complete",
                "omittedOptionalComponents": (['backend/node_modules/prismarine-viewer/public/'] if compact_modern_viewer else [])
                    + ([asset_directory + '/public/sounds/music/', asset_directory + '/public/sounds/records/']
                       if audio_profile == 'effects-only' else []),
                "files": {}}
    for file in sorted(destination.rglob("*")):
        if file.is_file():
            manifest["files"][file.relative_to(destination).as_posix()] = {"bytes": file.stat().st_size, "sha256": digest(file)}
    files = manifest.pop("files")
    (destination / INVENTORY).write_text(json.dumps(files, indent=2) + "\n", encoding="utf-8")
    manifest["inventory"] = {"path": INVENTORY, "sha256": digest(destination / INVENTORY), "files": len(files)}
    (destination / MANIFEST).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    verify_bundle(destination)
    return destination


def compose_delivery(runtime: Path, plugin: Path, output: Path, instructions: Path) -> Path:
    """Compose an external ZIP around an actual, normally bounded official SDK plugin."""
    verify_bundle(runtime)
    if plugin.suffix != ".neko-plugin" or not plugin.is_file() or plugin.stat().st_size > 500 * 1024**2:
        raise ValueError("Supply the real official SDK .neko-plugin within its 500 MiB import limit")
    with zipfile.ZipFile(plugin) as archive:
        rows = archive.infolist()
        if len(rows) > 10000 or sum(row.file_size for row in rows) > 1024**3 or any(row.file_size > 256 * 1024**2 for row in rows):
            raise ValueError("SDK plugin exceeds normal entry/expanded/member limits")
        names = set()
        for row in rows:
            name = relative_path(row.filename.rstrip("/"))
            if name.casefold() in names or stat.S_ISLNK(row.external_attr >> 16):
                raise ValueError("Invalid SDK plugin member")
            names.add(name.casefold())
        if not rows:
            raise ValueError("SDK plugin is empty")
    if output.exists():
        raise ValueError("Output already exists")
    # Runtime remains adjacent to the plugin; users import only the normal plugin.
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.write(plugin, plugin.name)
        archive.write(instructions, "README.txt")
        for file in sorted(runtime.rglob("*")):
            if file.is_file():
                archive.write(file, "runtime/" + file.relative_to(runtime).as_posix())
        archive.writestr("prepare.cmd", '@echo off\r\ncall "%~dp0runtime\\prepare.cmd"\r\nexit /b %errorlevel%\r\n')
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--bundle-id", required=True)
    parser.add_argument("--compact-modern-viewer", action="store_true",
                        help="Omit only the unselected legacy Prismarine browser's static public tree; retain its WorldView library")
    parser.add_argument('--viewer-tools-directory', type=Path,
                        help='Explicit fixed auxiliary source input required by the selected viewer pin')
    parser.add_argument('--audio-profile', choices=['complete', 'effects-only'], default='complete')
    for name in ("node", "backend", "viewer", "assets", "appearances", "licenses", "browser"):
        parser.add_argument(f"--{name}-directory", type=Path, required=True)
    args = vars(parser.parse_args())
    print(build_bundle(**args))


if __name__ == "__main__":
    main()
