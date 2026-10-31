"""Build a download-index-only .mrpack from the reviewed lock.

No account/session files, game assets, third-party binaries, world saves or
management keys enter the distribution. Downloads point to original releases.
"""
import argparse
import json
from pathlib import Path
import zipfile

from prepare import HERE, digest


def build(output, release_id=None):
    spec = json.loads((HERE / "pack.spec.json").read_text(encoding="utf-8"))
    lock = json.loads((HERE / "pack.lock.json").read_text(encoding="utf-8"))
    if lock["specSha256"] != digest(HERE / "pack.spec.json"):
        raise ValueError("Spec and lock differ")
    files = []
    config = json.loads((HERE / "deployment.local.json").read_text())
    components = config.get("localComponents", [])
    if not components:
        raise ValueError("Prepare the verified compatibility component before packaging")
    for entry in lock["mods"] + lock["external"]:
        hashes = {k: v for k, v in entry["hashes"].items() if k in ("sha1", "sha512")}
        if not hashes:
            raise ValueError("Missing supported distribution checksum")
        files.append({"path": "mods/" + entry["filename"], "hashes": hashes,
                      "downloads": [entry["url"]], "fileSize": entry["size"],
                      "env": {side: ("required" if side in entry["sides"] else "unsupported") for side in ("client", "server")}})
    index = {"formatVersion": 1, "game": "minecraft", "versionId": release_id or spec["version"],
             "name": spec["name"], "summary": "Fabric 26.3 isolated Java/Agent validation world; no public compatibility claim.",
             "files": files, "dependencies": {"minecraft": spec["minecraft"], "fabric-loader": spec["loader"]}}
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise ValueError("Distribution already exists; choose a new version/path")
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("modrinth.index.json", json.dumps(index, ensure_ascii=False, indent=2))
        z.writestr("overrides/options.txt", "lang:zh_cn\npauseOnLostFocus:false\nfullscreen:false\n")
        z.writestr("overrides/LAB-README.txt", "My Agent World: Living Adventures\nMinecraft 26.3 / Fabric 0.20.1 / Java 25\n"
                   "This package is an isolated validation candidate. Use a separate launcher instance.\n"
                   "GraalWeave is trusted local code execution. Its endpoint stays on loopback.\n"
                   "Do not expose its discovery socket or copy administrator files into a public package.\n"
                   "Existing SAO/Youer worlds, passwords and player data are not migrated.\n")
        for component in components:
            path = Path(config["client"]) / "mods" / component["filename"]
            if digest(path) != component["sha256"]:
                raise ValueError("Source-owned component hash differs from deployment")
            z.writestr("overrides/mods/" + component["filename"], path.read_bytes())
        z.writestr("overrides/maw-compat-source/VerifiedCraftMixin.java", (HERE / "compat-src" / "VerifiedCraftMixin.java").read_bytes())
    with zipfile.ZipFile(output) as z:
        assert set(z.namelist()) == {"modrinth.index.json", "overrides/options.txt", "overrides/LAB-README.txt", "overrides/maw-compat-source/VerifiedCraftMixin.java"} | {"overrides/mods/" + c["filename"] for c in components}
        assert len(json.loads(z.read("modrinth.index.json"))["files"]) == len(files)
    print(json.dumps({"path": str(output), "files": len(files), "sha256": digest(output), "bytes": output.stat().st_size}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--release-id", help="Distribution revision; mod versions remain pinned by the lock")
    args = parser.parse_args()
    build(args.output, args.release_id)
