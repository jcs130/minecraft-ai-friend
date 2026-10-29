import hashlib
import json
import sys

import pytest

from agent_mc_autonomy.core_distribution import install
from agent_mc_autonomy.filesystem import verification_path


def runtime_fixture(tmp_path, monkeypatch, *, long_file=False):
    directory = tmp_path / "runtime"
    root = directory / "node_modules/agent-mc-world"
    entry = root / "bin/minecraft-agent-mcp.mjs"
    entry.parent.mkdir(parents=True)
    entry.write_bytes(b"#!/usr/bin/env node\n// fixture\n")
    manifest = root / "package.json"
    manifest.write_text(json.dumps({"name": install.SOURCE["name"], "version": install.SOURCE["version"]}), encoding="utf-8")
    relative = "dist/runtime/" + ("nested-source-segment/" * 10 if long_file else "") + "entry.js"
    code = root / relative
    verification_path(code).parent.mkdir(parents=True, exist_ok=True)
    verification_path(code).write_bytes(b"export const actual = 1;\n")
    receipt = {"schema": "agent-mc-build/v1", "viewer": {"included": False}, "sourceFiles": [],
               "files": [{"file": relative, "sha256": hashlib.sha256(verification_path(code).read_bytes()).hexdigest()}]}
    (root / "dist/build.json").write_text(json.dumps(receipt), encoding="utf-8")
    (root / "dist/types").mkdir()
    (root / "dist/types/manifest.json").write_text('{"files":[]}', encoding="utf-8")
    pin = {**install.SOURCE, "verification": {
        name: hashlib.sha256((root / name).read_bytes()).hexdigest()
        for name in ["package.json", "dist/build.json", "dist/types/manifest.json", "bin/minecraft-agent-mcp.mjs"]}}
    monkeypatch.setattr(install, "SOURCE", pin)
    return directory, root, code


@pytest.mark.skipif(sys.platform != "win32", reason="Windows legacy MAX_PATH regression")
def test_present_long_build_file_does_not_depend_on_hosts_long_path_manifest(tmp_path, monkeypatch):
    directory, _, code = runtime_fixture(tmp_path, monkeypatch, long_file=True)
    assert len(str(code)) > 260
    original = type(code).is_file

    def legacy_is_file(path):
        # Reproduced with a real longPathAware=false Win32 process: the same
        # released core file fails under its ordinary path and exists with \\?\.
        if len(str(path)) >= 260 and not str(path).startswith("\\\\?\\"):
            return False
        return original(path)

    monkeypatch.setattr(type(code), "is_file", legacy_is_file)
    assert not code.is_file()
    assert install.verify_runtime(directory) == install.runtime_entry(directory)
    verification_path(code).write_bytes(b"tampered")
    with pytest.raises(ValueError, match="backend_build_mismatch"):
        install.verify_runtime(directory)


def test_missing_build_error_identifies_relative_member_without_host_path(tmp_path, monkeypatch):
    directory, root, code = runtime_fixture(tmp_path, monkeypatch)
    relative = code.relative_to(root).as_posix()
    code.unlink()
    with pytest.raises(ValueError, match="backend_build_mismatch") as error:
        install.verify_runtime(directory)
    assert relative in str(error.value)
    assert str(tmp_path) not in str(error.value)


def test_build_receipt_cannot_escape_package_after_path_normalization(tmp_path, monkeypatch):
    directory, root, _ = runtime_fixture(tmp_path, monkeypatch)
    outside = root.parent / "outside.js"
    outside.write_bytes(b"outside")
    receipt = json.loads((root / "dist/build.json").read_text())
    receipt["files"] = [{"file": "../outside.js", "sha256": hashlib.sha256(outside.read_bytes()).hexdigest()}]
    (root / "dist/build.json").write_text(json.dumps(receipt), encoding="utf-8")
    install.SOURCE["verification"]["dist/build.json"] = hashlib.sha256((root / "dist/build.json").read_bytes()).hexdigest()
    with pytest.raises(ValueError, match="backend_build_mismatch"):
        install.verify_runtime(directory)
