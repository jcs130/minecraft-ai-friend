"""Explicitly build the pinned independent core in a new directory, offline after dependency preparation."""

import argparse
import hashlib
import json
import shutil
import subprocess
import tarfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REVISION = "7889ce261a2309d94400b739c6198468d8271d83"


def build(checkout: Path, destination: Path) -> Path:
    destination = destination.resolve()
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("Build destination must be empty; existing runtimes are never replaced.")
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / "source.tar"
    subprocess.run(["git", "-C", str(checkout), "archive", "--format=tar", f"--output={archive}",
                    f"{REVISION}:packages/agent-mc-world"], check=True, timeout=60)
    with tarfile.open(archive) as source:
        for member in source.getmembers():
            target = (destination / member.name).resolve()
            if not target.is_relative_to(destination) or not (member.isfile() or member.isdir()):
                raise ValueError("Unsafe source archive member")
        source.extractall(destination, filter="data")
    # Exact source from Git, not uncommitted files or a deployed agent's working directory.
    source_pin = json.loads((HERE / "source.json").read_text(encoding="utf-8"))
    for item in source_pin["patches"]:
        patch = (HERE / item["file"]).resolve()
        if not patch.is_relative_to(HERE) or hashlib.sha256(patch.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("Reviewed source patch does not match its pinned hash.")
        subprocess.run(["git", "apply", "--no-index", "--ignore-space-change", "--check", str(patch)], cwd=destination, check=True, timeout=30)
        subprocess.run(["git", "apply", "--no-index", "--ignore-space-change", str(patch)], cwd=destination, check=True, timeout=30)
    pnpm = shutil.which("pnpm.cmd") or shutil.which("pnpm")
    if not pnpm:
        raise ValueError("Install pnpm 11.5.0 (the upstream lockfile's package manager) first.")
    if subprocess.check_output([pnpm, "--version"], cwd=destination, text=True, timeout=60).strip() != "11.5.0":
        raise ValueError("The build requires pnpm 11.5.0.")
    subprocess.run([pnpm, "install", "--frozen-lockfile", "--ignore-scripts"], cwd=destination, check=True, timeout=600)
    subprocess.run(["node", str(HERE / "build-headless.mjs"), str(destination)], check=True, timeout=120)
    subprocess.run(["node", "scripts/build-types.mjs"], cwd=destination, check=True, timeout=180)
    # Package only this profile's source, runtime and public types. Old launch mods,
    # host migration helpers and another profile's build/provenance files are not inputs.
    shutil.copyfile(HERE / "README-core.md", destination / "README.md")
    manifest = destination / "package.json"
    package = json.loads(manifest.read_text(encoding="utf-8"))
    package["nekoBuild"] = {"profile": "headless", "sourceRevision": REVISION, "minecraftVersion": "1.21.1",
                            "patches": source_pin["patches"]}
    receipt = json.loads((destination / "dist/neko-headless.json").read_text(encoding="utf-8"))
    package["files"] = sorted({entry["file"] for entry in receipt["sourceFiles"]} | {
        "dist", "bin/minecraft-agent-client.mjs", "bin/minecraft-agent-mcp.mjs", "README.md", "LICENSE"})
    package["scripts"] = {key: value for key, value in package["scripts"].items() if key in {"start:mcp", "start:minecraft"}}
    manifest.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
    subprocess.run(["node", str(HERE / "check-core.mjs"), str(destination)], check=True, timeout=60)
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    subprocess.run([npm, "pack", "--ignore-scripts", "--silent"], cwd=destination, check=True, timeout=120)
    return destination / "agent-mc-world-0.4.0.tgz"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    print(build(args.checkout, args.destination))


if __name__ == "__main__":
    main()
