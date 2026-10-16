"""Explicitly build the pinned independent core in a new directory, offline after dependency preparation."""

import argparse
import json
import shutil
import subprocess
import tarfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


def build(checkout: Path, destination: Path) -> Path:
    source_pin = json.loads((HERE / "source.json").read_text(encoding="utf-8"))
    destination = destination.resolve()
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("Build destination must be empty; existing runtimes are never replaced.")
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / "source.tar"
    subprocess.run(["git", "-C", str(checkout), "-c", "core.autocrlf=false", "-c", "core.eol=lf", "archive", "--format=tar", f"--output={archive}",
                    f"{source_pin['source_revision']}:{source_pin['source_path']}"], check=True, timeout=60)
    with tarfile.open(archive) as source:
        for member in source.getmembers():
            target = (destination / member.name).resolve()
            if not target.is_relative_to(destination) or not (member.isfile() or member.isdir()):
                raise ValueError("Unsafe source archive member")
        source.extractall(destination, filter="data")
    # Exact source from Git, not uncommitted files or a deployed agent's working directory.
    pnpm = shutil.which("pnpm.cmd") or shutil.which("pnpm")
    if not pnpm:
        raise ValueError("Install pnpm 11.5.0 (the upstream lockfile's package manager) first.")
    if subprocess.check_output([pnpm, "--version"], cwd=destination, text=True, timeout=60).strip() != "11.5.0":
        raise ValueError("The build requires pnpm 11.5.0.")
    # Prepare dependencies explicitly beforehand if missing from pnpm's local store.
    subprocess.run([pnpm, "install", "--offline", "--frozen-lockfile", "--ignore-scripts"], cwd=destination, check=True, timeout=600)
    subprocess.run([pnpm, "build:engine"], cwd=destination, check=True, timeout=240)
    subprocess.run(["node", str(HERE / "check-core.mjs"), str(destination)], check=True, timeout=60)
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    subprocess.run([npm, "pack", "--silent"], cwd=destination, check=True, timeout=120)
    return destination / source_pin["archive"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    print(build(args.checkout, args.destination))


if __name__ == "__main__":
    main()
