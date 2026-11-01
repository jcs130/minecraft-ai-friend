"""Install a packed self-authored core with the same pinned native protocol stack."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
from prepare_runtime import HERE, sha


def prepare(runtime, archive, node, npm_cli, resolve_dependencies=False, name='sdk'):
    runtime = runtime.resolve()
    owner = json.loads((runtime / "runtime-owner.json").read_text())
    if owner["scope"] != "maw-fabric263-mineflayer" or owner["lockSha256"] != sha(HERE / "upstream.lock.json"):
        raise ValueError("SDK requires this exact owned native runtime")
    lock = json.loads((HERE / "core.lock.json").read_text())
    if archive.stat().st_size != lock["bytes"] or sha(archive) != lock["sha256"]:
        raise ValueError("Packed core differs from the accepted archive")
    import re
    if not re.fullmatch(r'sdk(?:-[a-zA-Z0-9_.-]+)?', name): raise ValueError('Use a plain sdk or sdk-version directory name')
    root = runtime / name
    root.mkdir(exist_ok=False)
    shutil.copy2(archive, root / "agent-mc-world.tgz")
    names = [r["name"] for r in json.loads((HERE / "upstream.lock.json").read_text())["sources"] if r["name"] != "minecraft-data-tables"]
    deps = {name: "file:../vendor/" + name for name in names}
    deps.update({"agent-mc-world": "file:agent-mc-world.tgz", "protodef": "1.19.0", "mineflayer-pathfinder": "2.4.5"})
    package = {"name": "maw-native263-sdk", "version": "0.1.0", "private": True, "type": "module", "dependencies": deps,
               "overrides": {name: "$" + name for name in names}}
    (root / "package.json").write_text(json.dumps(package, indent=2) + "\n")
    public_lock = HERE / "sdk-npm-lock.json"
    if not resolve_dependencies:
        locked = json.loads(public_lock.read_text())
        if locked["packages"][""]["dependencies"] != deps: raise ValueError("SDK dependency lock differs")
        shutil.copy2(public_lock, root / "package-lock.json")
    production = ['create_bot.cjs', 'native_registry.cjs', 'mod_configuration.cjs', 'views.cjs', 'menus.cjs', 'recipes.cjs',
                  'native_protocol.cjs', 'native_tools.cjs', 'engine.mjs', 'mcp.mjs']
    for name in production:
        shutil.copy2(HERE / name, root / name)
    with (root / "install.log").open("wb") as log:
        subprocess.run([str(node), str(npm_cli), "install" if resolve_dependencies else "ci", "--install-links", "--ignore-scripts", "--no-audit", "--no-fund",
                        "--cache", str(runtime.parent / "archives/npm-cache")], cwd=root, stdout=log, stderr=subprocess.STDOUT, check=True)
    (root / "sdk-receipt.json").write_text(json.dumps({"schemaVersion": 1, "core": lock,
        "npmLockSha256": sha(root / "package-lock.json"), "adapter": {p.name: sha(p) for p in root.iterdir() if p.suffix in (".cjs", ".mjs")}}, indent=2) + "\n")
    return root


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--runtime", type=Path, required=True); ap.add_argument("--core-archive", type=Path, required=True)
    ap.add_argument("--node", type=Path, required=True); ap.add_argument("--npm-cli", type=Path, required=True)
    ap.add_argument("--resolve-dependencies", action="store_true", help="Maintainer-only initial lock creation; review and publish lock before distribution")
    ap.add_argument("--name", default="sdk", help="New SDK folder inside this owned runtime; existing folders are never replaced")
    args = ap.parse_args()
    print(prepare(args.runtime, args.core_archive, args.node, args.npm_cli, args.resolve_dependencies, args.name))
