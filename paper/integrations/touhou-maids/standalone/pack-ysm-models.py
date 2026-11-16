"""Package the NPC YSM models from the pinned, creator-published source archives."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


MANIFEST = Path(__file__).with_name("examples") / "npc-ysm-models.json"
MODEL_EXTENSIONS = {".json", ".png", ".jpg", ".molang"}
CREDIT_FILES = {"LICENSE", "ATTRIBUTION.md", "readme.txt"}


def model_files(archive_dir, model):
    source = (archive_dir / model["archive"]).read_bytes()
    if hashlib.sha256(source).hexdigest() != model["sha256"]:
        raise ValueError(f"Archive SHA-256 differs for {model['id']}")
    assets, credits = {}, {}
    with ZipFile(io.BytesIO(source)) as archive:
        for member in archive.infolist():
            if member.is_dir():
                continue
            path = PurePosixPath(member.filename)
            if path.is_absolute() or len(path.parts) < 2 or ".." in path.parts or "\\" in member.filename:
                raise ValueError(f"Unexpected archive path for {model['id']}")
            relative = PurePosixPath(*path.parts[1:])
            if len(relative.parts) == 1 and relative.name in CREDIT_FILES:
                credits[relative.name] = archive.read(member)
            if model["modelRoot"]:
                if not relative.is_relative_to(model["modelRoot"]):
                    continue
                relative = relative.relative_to(model["modelRoot"])
            if relative.suffix in MODEL_EXTENSIONS:
                name = relative.as_posix()
                if name in assets:
                    raise ValueError(f"Duplicate file in {model['id']}: {name}")
                assets[name] = archive.read(member)

    info = json.loads(assets["ysm.json"])
    player = info["files"]["player"]
    texture_ids = {PurePosixPath(item["uv"]).stem for item in player["texture"]}
    if (info["spec"] != 2 or model["texture"] not in texture_ids or "LICENSE" not in credits
            or not all(item["uv"] in assets for item in player["texture"])
            or not all(path in assets for path in (*player["model"].values(), *player["animation"].values()))):
        raise ValueError(f"Incomplete YSM pack for {model['id']}")
    for name, body in assets.items():
        yield f"config/yes_steve_model/custom/{model['id']}/{name}", body
    for name, body in credits.items():
        yield f"credits/{model['id']}/{name}", body


def pack(archive_dir, output):
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    entries = {"npc-ysm-models.json": manifest_bytes}
    notice = ["# 千灯纪女仆 NPC 模型库", "",
              "服务端使用 Minecraft 1.21.1、NeoForge、车万女仆 1.5.3 与 YSM 2.6.5。",
              "将 config 目录合并到独立测试服根目录。服务端控制台运行 ysm model reload。",
              "装有同版本车万女仆和 YSM 的客户端进服后同步模型。女仆主人在模型界面选用对应模型与贴图。",
              "原始几何、贴图、动画、作者信息及模型配置均保留，仅整理安装路径。", ""]
    for model in manifest["models"]:
        entries.update(model_files(archive_dir, model))
        notice.extend([f"## {model['npc']} · {model['name']}", "",
                       model["credits"],
                       f"游戏内模型 ID 为 `{model['id']}`，试用贴图为 `{model['texture']}`。",
                       f"[原始资源](https://github.com/{model['repository']}/tree/{model['revision']})"
                       f" · [CC BY 4.0]({model['license']})", ""])
    entries["README.md"] = "\n".join(notice).encode("utf-8")
    with ZipFile(output, "x") as archive:
        for name, value in sorted(entries.items()):
            archive.writestr(ZipInfo(name), value, compress_type=ZIP_DEFLATED)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archives", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    pack(args.archives, args.output)
