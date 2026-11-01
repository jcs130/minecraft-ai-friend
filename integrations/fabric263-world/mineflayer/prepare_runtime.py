"""Build an isolated, pinned native-777 Mineflayer runtime. No global npm changes."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
import urllib.request

HERE = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def extract(archive, destination):
    """Only ordinary files below one archive root; never links or traversals."""
    destination = destination.resolve()
    destination.mkdir(parents=True, exist_ok=False)
    total = 0
    with tarfile.open(archive) as tar:
        for member in tar:
            parts = PurePosixPath(member.name).parts
            if PurePosixPath(member.name).is_absolute():
                raise ValueError("Absolute archive path")
            if len(parts) < 2:
                continue
            if any(p in ("..", "") or ":" in p or "\\" in p for p in parts):
                raise ValueError("Unsafe archive path")
            target = destination.joinpath(*parts[1:]).resolve()
            if not target.is_relative_to(destination) or member.issym() or member.islnk():
                raise ValueError("Unsafe archive member")
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                total += member.size
                if total > 512 * 1024 * 1024:
                    raise ValueError("Expanded archive budget exceeded")
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("xb") as out, tar.extractfile(member) as data:
                    shutil.copyfileobj(data, out)
            else:
                raise ValueError("Unsupported archive member")


def replace(path, before, after, count=1):
    text = path.read_text(encoding="utf-8")
    if text.count(before) != count:
        raise ValueError("Reviewed patch anchor differs: " + str(path))
    path.write_text(text.replace(before, after), encoding="utf-8", newline="\n")


def patch(vendor):
    mf = vendor / "mineflayer"
    replace(mf / "lib/version.js", "'1.21.11', '26.1']", "'1.21.11', '26.1', '26.3']")
    replace(mf / "lib/plugins/physics.js",
            "bot._client.write('teleport_confirm', { teleportId })",
            "bot._client.write('teleport_confirm', bot.version === '26.3'\n"
            "        ? { teleportId, x: pos.x, y: pos.y, z: pos.z, yRot: yaw, xRot: pitch }\n"
            "        : { teleportId })")
    replace(mf / "lib/plugins/digging.js", "status: 2, // finish digging", "status: bot.version === '26.3' ? 3 : 2, // finish digging")
    replace(mf / "lib/plugins/digging.js", "status: 1, // cancel digging", "status: bot.version === '26.3' ? 2 : 1, // cancel digging")
    replace(mf / "lib/plugins/inventory.js", "status: 5,", "status: bot.version === '26.3' ? 6 : 5,")
    replace(mf / "lib/loader.js", "  function next () {", "  async function next () {")
    replace(mf / "lib/loader.js", "    const versionData = bot.registry.version",
            "    if (options.registryBootstrap) {\n"
            "      try { await options.registryBootstrap(bot.registry, bot._client) } catch (error) {\n"
            "        bot.emit('error', error); bot._client.end('native_registry_bootstrap_failed'); return\n"
            "      }\n"
            "    }\n"
            "    const versionData = bot.registry.version")
    patch_teleport_tick(mf)
    patch_initial_tick(mf)
    patch_window_factory(mf)
    for module in ("prismarine-entity", "prismarine-item"):
        replace(mf / "lib/plugins/entities.js", "require('" + module + "')(bot.version)", "require('" + module + "')(bot.registry)")
    patch_protocol(vendor / "minecraft-protocol")
    features = vendor / "prismarine-physics/lib/features.json"
    data = json.loads(features.read_text())
    for feature in data:
        if "26.1" in feature["versions"] and "26.3" not in feature["versions"]:
            feature["versions"].append("26.3")
    features.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8", newline="\n")
    # Protocol's uniform entityDelta is a sequence of fixed-point deltas, not a
    # single flat triple. Normalize at the packet boundary before MF listeners.
    # Installed by create_bot.cjs; unknown packets still fail instead of guessing.


def patch_teleport_tick(mf):
    physics = mf / "lib/plugins/physics.js"
    replace(physics, "  let shouldUsePhysics = false", "  let shouldUsePhysics = false\n  let nativeTeleportThisTick = false")
    replace(physics, "    flushReplies()\n    if (!bot.entity?.position", "    nativeTeleportThisTick = false\n    flushReplies()\n    if (!bot.entity?.position")
    replace(physics, "    if (bot.blockAt(bot.entity.position) != null) {", "    if (!nativeTeleportThisTick && bot.blockAt(bot.entity.position) != null) {")
    replace(physics, "    // After death/respawn, delay the forced position_look response.",
            "    if (bot.version === '26.3') {\n"
            "      // Native teleport_confirm already carries a full position. A\n"
            "      // second position-bearing packet before tick_end is invalid.\n"
            "      Object.assign(lastSent, { x: pos.x, y: pos.y, z: pos.z, yaw, pitch, onGround: false })\n"
            "      nativeTeleportThisTick = true\n"
            "      confirmMove()\n"
            "      return\n"
            "    }\n\n"
            "    // After death/respawn, delay the forced position_look response.")


def patch_window_factory(mf):
    inventory = mf / "lib/plugins/inventory.js"
    replace(inventory, "function inject (bot, { hideErrors }) {", "function inject (bot, { hideErrors, nativeWindowFactory }) {")
    replace(inventory, "  const windows = require('prismarine-windows')(bot.version)",
            "  const windows = require('prismarine-windows')(bot.registry)\n"
            "  if (nativeWindowFactory) {\n"
            "    const original = windows.createWindow\n"
            "    windows.createWindow = (id, type, title, slotCount) => nativeWindowFactory({ bot, windows, original, id, type, title, slotCount })\n"
            "  }")


def patch_initial_tick(mf):
    physics = mf / "lib/plugins/physics.js"
    replace(physics, "  let nativeTeleportThisTick = false", "  let nativeTeleportThisTick = false\n  let nativeInitialTickEnded = false")
    replace(physics, "    nativeTeleportThisTick = false\n    flushReplies()",
            "    if (bot.version === '26.3' && !nativeInitialTickEnded) {\n"
            "      // Finish the first position-free client tick before confirming\n"
            "      // initial placement. This establishes the server's movement baseline.\n"
            "      nativeInitialTickEnded = true\n"
            "      bot._client.write('tick_end', {})\n"
            "      return\n"
            "    }\n"
            "    nativeTeleportThisTick = false\n    flushReplies()")


def patch_protocol(protocol):
    serializer = protocol / "src/transforms/serializer.js"
    replace(serializer, "  const key = `${state};${direction};${version}${compiled ? ';c' : ''}`",
            "  const schemaHash = customPackets ? require('node:crypto').createHash('sha256').update(JSON.stringify(customPackets)).digest('hex') : ''\n"
            "  const key = `${state};${direction};${version}${compiled ? ';c' : ''};${schemaHash}`")
    replace(serializer, "  const mergedProtocol = merge(mcData.protocol, customPackets?.[mcData.version.majorVersion] ?? {})",
            "  const mergedProtocol = structuredClone(mcData.protocol)\n"
            "  const overlay = (target, source) => {\n"
            "    for (const [name, value] of Object.entries(source)) {\n"
            "      if (value && typeof value === 'object' && !Array.isArray(value)) {\n"
            "        if (!target[name] || typeof target[name] !== 'object' || Array.isArray(target[name])) target[name] = {}\n"
            "        overlay(target[name], value)\n"
            "      } else target[name] = structuredClone(value)\n"
            "    }\n"
            "  }\n"
            "  overlay(mergedProtocol, customPackets?.[mcData.version.majorVersion] ?? {})")
    compiler = protocol / "src/datatypes/compiler-minecraft.js"
    for section in ("Read", "Write", "SizeOf"):
        replace(compiler, "  " + section + ": {",
                "  " + section + ": {\n"
                "    failNativeCodec: ['parametrizable', (compiler, opts) => compiler.wrapCode('throw new Error(' + JSON.stringify('UNSUPPORTED_NATIVE_CODEC:' + opts.name) + ')')],")


def prepare(runtime, archives, node, npm_cli):
    runtime = runtime.resolve()
    if runtime.exists():
        raise ValueError("Use a new runtime directory; existing runtimes are never overwritten")
    lock = json.loads((HERE / "upstream.lock.json").read_text())
    for row in lock["sources"]:
        archive = archives / (row["name"] + ".tgz")
        if not archive.exists():
            archive.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(row["url"], timeout=60) as response, archive.open("xb") as out:
                shutil.copyfileobj(response, out)
        if archive.stat().st_size != row["bytes"] or sha(archive) != row["sha256"]:
            raise ValueError("Source archive hash mismatch: " + row["name"])
    runtime.mkdir(parents=True)
    (runtime / "runtime-owner.json").write_text(json.dumps({"scope": "maw-fabric263-mineflayer", "lockSha256": sha(HERE / "upstream.lock.json")}) + "\n")
    vendor = runtime / "vendor"
    vendor.mkdir()
    for row in lock["sources"]:
        extract(archives / (row["name"] + ".tgz"), vendor / row["name"])
    # The npm JS wrapper generates data.js from this exact table revision.
    shutil.copytree(vendor / "minecraft-data-tables", vendor / "minecraft-data/minecraft-data", dirs_exist_ok=True)
    patch(vendor)
    for name in [row["name"] for row in lock["sources"] if row["name"] != "minecraft-data-tables"]:
        manifest = vendor / name / "package.json"
        package = json.loads(manifest.read_text())
        # npm 10 can run local dependency 'prepare' even with ignore-scripts.
        # The necessary data generator is invoked explicitly below after review.
        package["scripts"] = {}
        package.pop("devDependencies", None)
        manifest.write_text(json.dumps(package, indent=2) + "\n")
    subprocess.run([str(node), "bin/generate_data.js"], cwd=vendor / "minecraft-data", check=True)
    names = [row["name"] for row in lock["sources"] if row["name"] != "minecraft-data-tables"]
    deps = {name: "file:vendor/" + name for name in names}
    deps.update(lock["dependencies"])
    package = {"name": "maw-native263-runtime", "version": "0.1.0", "private": True,
               "dependencies": deps, "overrides": {name: "$" + name for name in names}}
    (runtime / "package.json").write_text(json.dumps(package, indent=2) + "\n")
    npm_lock = json.loads((HERE / "npm-lock.json").read_text())
    if npm_lock["packages"][""]["dependencies"] != deps:
        raise ValueError("Reviewed npm lock does not match root dependencies")
    shutil.copy2(HERE / "npm-lock.json", runtime / "package-lock.json")
    # --install-links copies local packages rather than leaving nested symlinks
    # with their own dependency resolution. Transitive copies use root overrides.
    command = [str(node), str(npm_cli), "ci", "--install-links", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", str(archives / "npm-cache")]
    with (runtime / "npm-install.log").open("wb") as log:
        subprocess.run(command, cwd=runtime, stdout=log, stderr=subprocess.STDOUT, check=True)
    (runtime / "build-receipt.json").write_text(json.dumps({"schemaVersion": 1, "runtime": str(runtime),
        "lockSha256": sha(HERE / "upstream.lock.json"), "patcherSha256": sha(Path(__file__)),
        "npmLockSha256": sha(runtime / "package-lock.json")}, indent=2) + "\n")
    return runtime


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", required=True, type=Path)
    parser.add_argument("--archives", required=True, type=Path)
    parser.add_argument("--node", required=True, type=Path)
    parser.add_argument("--npm-cli", required=True, type=Path)
    args = parser.parse_args()
    print(prepare(args.runtime, args.archives, args.node, args.npm_cli))
