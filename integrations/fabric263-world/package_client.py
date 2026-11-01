"""Build a download-index-only .mrpack from the reviewed lock.

No account/session files, game assets, third-party binaries, world saves or
management keys enter the distribution. Downloads point to original releases.
"""
import argparse
import json
from pathlib import Path
import zipfile

from prepare import HERE, digest
from localize import PACK_NAME


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
    language_pack = Path(config["client"]) / "resourcepacks" / PACK_NAME
    if digest(language_pack) != config.get("localization", {}).get("resourcePack", {}).get("sha256"):
        raise ValueError("Install the reviewed Chinese resource pack before packaging")
    for entry in lock["mods"] + lock["external"]:
        hashes = {k: v for k, v in entry["hashes"].items() if k in ("sha1", "sha512")}
        if not hashes:
            raise ValueError("Missing supported distribution checksum")
        files.append({"path": "mods/" + entry["filename"], "hashes": hashes,
                      "downloads": [entry["url"]], "fileSize": entry["size"],
                      "env": {side: ("required" if side in entry["sides"] else "unsupported") for side in ("client", "server")}})
    index = {"formatVersion": 1, "game": "minecraft", "versionId": release_id or spec["version"],
             "name": spec["name"], "summary": "Fabric 26.3 独立实验世界：村庄、委托、魔法与探索，含简体中文补全。",
             "files": files, "dependencies": {"minecraft": spec["minecraft"], "fabric-loader": spec["loader"]}}
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise ValueError("Distribution already exists; choose a new version/path")
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("modrinth.index.json", json.dumps(index, ensure_ascii=False, indent=2))
        z.writestr("overrides/options.txt", "lang:zh_cn\npauseOnLostFocus:false\nfullscreen:false\nresourcePacks:" + json.dumps(["file/" + PACK_NAME]) + "\n")
        z.writestr("overrides/resourcepacks/" + PACK_NAME, language_pack.read_bytes())
        z.writestr("overrides/LAB-README.txt", "My Agent World · 旅居与冒险\nMinecraft 26.3 / Fabric 0.20.1 / Java 25\n"
                   "请导入独立启动器实例。简体中文资源包已默认启用。\n"
                   "此包为独立实验候选版本，当前测试入口为本机回环。\n"
                   "GraalWeave 提供受信任的本地代码执行；其原始接口仅限回环。\n"
                   "未迁移 SAO/千灯纪的世界、密码和玩家数据。\n")
        for component in components:
            path = Path(config["client"]) / "mods" / component["filename"]
            if digest(path) != component["sha256"]:
                raise ValueError("Source-owned component hash differs from deployment")
            z.writestr("overrides/mods/" + component["filename"], path.read_bytes())
        z.writestr("overrides/maw-compat-source/VerifiedCraftMixin.java", (HERE / "compat-src" / "VerifiedCraftMixin.java").read_bytes())
        z.writestr("overrides/maw-compat-source/ChineseGeneratorMixin.java", (HERE / "compat-src" / "ChineseGeneratorMixin.java").read_bytes())
        z.writestr("overrides/maw-compat-source/ChineseQuestNamesMixin.java", (HERE / "compat-src" / "ChineseQuestNamesMixin.java").read_bytes())
        z.writestr("overrides/maw-compat-source/justquests-zh_cn.json", (Path(config["cache"]) / "localization/generated/justquests-zh_cn.json").read_bytes())
        z.writestr("overrides/maw-compat-source/COPYING", (HERE / "compat-src/COPYING").read_bytes())
        z.writestr("overrides/maw-compat-source/BUILD.txt", "My Agent World compatibility component 0.1.1\nGPL-3.0-only; source files and generated locale are included here.\nReproducible build scripts and pinned dependencies:\nhttps://github.com/jcs130/minecraft-ai-friend/tree/feat/tau-ceti-and-aincrad-20261026/integrations/fabric263-world\nJava 25 / Minecraft 26.3 / Fabric Loader 0.20.1 / JustQuests 0.4.5\n")
    with zipfile.ZipFile(output) as z:
        assert set(z.namelist()) == {"modrinth.index.json", "overrides/options.txt", "overrides/LAB-README.txt", "overrides/maw-compat-source/VerifiedCraftMixin.java", "overrides/maw-compat-source/ChineseGeneratorMixin.java", "overrides/maw-compat-source/ChineseQuestNamesMixin.java", "overrides/maw-compat-source/justquests-zh_cn.json", "overrides/maw-compat-source/COPYING", "overrides/maw-compat-source/BUILD.txt", "overrides/resourcepacks/" + PACK_NAME} | {"overrides/mods/" + c["filename"] for c in components}
        assert len(json.loads(z.read("modrinth.index.json"))["files"]) == len(files)
    print(json.dumps({"path": str(output), "files": len(files), "sha256": digest(output), "bytes": output.stat().st_size}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--release-id", help="Distribution revision; mod versions remain pinned by the lock")
    args = parser.parse_args()
    build(args.output, args.release_id)
