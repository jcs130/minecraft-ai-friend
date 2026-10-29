"""Reproducible server-only fix of the reviewed Vzling animation initializer."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile

from prepare_pack import digest


def patch(root):
    root = Path(root).resolve(strict=True)
    marker = json.loads((root / "pack-source.json").read_text("utf-8"))
    if marker.get("scope") != "isolated_testing" or marker["sha256"] != "707f8a9db948a9ad5855b28246ec46738a9a7fe953ed30d0531e4291967360bd":
        raise ValueError("Review another pack before applying this exact compatibility fix")
    state_path = root / "lab-process.json"
    if state_path.exists() and json.loads(state_path.read_text("utf-8"))["phase"] != "exited":
        raise ValueError("Stop the isolated JVM before changing its mod bytes")
    name = "vzling-0.98.7-1.20.1-forge.jar"
    entry = "vzling/lib/mixin/PlayerMixin.class"
    source, target = root / "client/mods" / name, root / "server/mods" / name
    plan = json.loads((root / "server-export.json").read_text("utf-8"))
    expected = next(row["sha256"] for row in plan["mods"] if row["filename"] == name)
    if digest(source) != expected:
        raise ValueError("Original Vzling bytes differ from the verified pack")
    record_file = root / "vzling-server-fix.json"
    if record_file.exists():
        record = json.loads(record_file.read_text("utf-8"))
        if digest(target) == record["patched_sha256"]:
            print(json.dumps({"already_applied": True, "changed_entries": record["changed_entries"]}))
            return
    if digest(target) != expected:
        raise ValueError("Server mod has unknown modifications")
    work = root / "build/vzling-server-fix"
    work.mkdir(parents=True, exist_ok=True)
    java = Path(json.loads((root / "runtime-lock.json").read_text("utf-8"))["java"]["java"])
    compiler = java.with_name("javac.exe")
    asm = root / "server/libraries/org/ow2/asm/asm/9.8/asm-9.8.jar"
    tree = root / "server/libraries/org/ow2/asm/asm-tree/9.8/asm-tree-9.8.jar"
    helper = Path(__file__).with_name("PatchSidedInit.java")
    cp = os.pathsep.join(map(str, (asm, tree)))
    subprocess.run([str(compiler), "--release", "17", "-cp", cp, "-d", str(work), str(helper)], check=True)
    with zipfile.ZipFile(source) as archive:
        if any(name.upper().startswith("META-INF/") and name.upper().endswith((".SF", ".RSA", ".DSA")) for name in archive.namelist()):
            raise ValueError("Do not alter a signed third-party artifact")
        original = work / "PlayerMixin.original.class"
        original.write_bytes(archive.read(entry))
        modified = work / "PlayerMixin.server.class"
        subprocess.run([str(java), "-cp", os.pathsep.join((str(work), cp)), "PatchSidedInit", str(original), str(modified)], check=True)
        temporary = target.with_suffix(".jar.compat-part")
        with zipfile.ZipFile(temporary, "w") as output:
            for item in archive.infolist():
                output.writestr(item, modified.read_bytes() if item.filename == entry else archive.read(item))
    with zipfile.ZipFile(source) as before, zipfile.ZipFile(temporary) as after:
        if before.namelist() != after.namelist() or after.testzip() is not None:
            raise ValueError("Patched archive structure changed")
        changed = [name for name in before.namelist() if hashlib.sha256(before.read(name)).digest() != hashlib.sha256(after.read(name)).digest()]
        if changed != [entry]:
            raise ValueError("Unexpected changes outside the dedicated animation initializer")
    record = {"original_sha256": expected, "patched_sha256": digest(temporary), "changed_entries": changed, "server_only": True, "client_original_preserved": digest(source) == expected, "common_animation_interface_preserved": True, "reason": "mixin links a render-only class before evaluating its client-side guard", "helper_sha256": digest(helper)}
    os.replace(temporary, target)
    record_file.write_text(json.dumps(record, indent=2), encoding="utf-8")
    print(json.dumps(record, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    patch(parser.parse_args().root)
