# -*- coding: utf-8 -*-
"""生成 mc-world 分发版的初始数据资产。

从造物主服务器 data/（活数据）提取「核心资产」，剔除动漫 IP、清历史，
输出到 packaging/mc-world/assets/data/ 作为分发版初始种子。

动作：
  1. magic-atoms.json  → 删除火影 IP 原子 rasengan / kage_bunshin
  2. skins.json        → assignments 改为 Steve/Alex
  3. advancement-names.json → 直接复制
  （drown_sentry.py 为私服 Docker 巡检脚本：硬编码 RCON 密码 + /app 路径 + 私服假玩家名，
    分发版巡检由世界进程内 mc-terra.ts 承担，不再复制。）
"""
import json
import shutil
from pathlib import Path

SRC = Path(r"C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\scratch-plugin\data")
DST = Path(r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\packaging\mc-world\assets\data")

DROP_ATOMS = {"rasengan", "kage_bunshin"}  # 火影忍者 IP 技能，分发版剔除


def process_magic_atoms() -> int:
    src = SRC / "magic-atoms.json"
    data = json.loads(src.read_text(encoding="utf-8"))
    # 找到顶层 list（原子数组）
    arr_key = None
    for k, v in data.items():
        if isinstance(v, list):
            arr_key = k
            break
    assert arr_key, "magic-atoms.json 顶层未找到数组"
    atoms = data[arr_key]
    before = len(atoms)
    kept = [a for a in atoms if a.get("id") not in DROP_ATOMS]
    data[arr_key] = kept
    dropped = before - len(kept)
    out = DST / "magic-atoms.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[magic-atoms] {before} -> {len(kept)} 个原子，剔除 {dropped} 个动漫 IP: {sorted(DROP_ATOMS)}")
    return len(kept)


def process_skins() -> None:
    src = SRC / "skins.json"
    data = json.loads(src.read_text(encoding="utf-8"))
    # 剔除动漫 IP 皮肤（source=local 的 kirito/naruto/edward），只留官方皮肤
    presets = data.get("presets", {})
    local = [k for k, v in presets.items() if v.get("source") == "local"]
    for k in local:
        presets.pop(k, None)
    data["presets"] = presets
    data["assignments"] = {"Steve": "steve", "Alex": "alex"}
    out = DST / "skins.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    kept = list(presets.keys())
    print(f"[skins] 剔除动漫皮肤 {local}；保留官方皮肤 {len(kept)} 个: {kept}")


def copy_assets() -> None:
    for name in ("advancement-names.json",):
        src = SRC / name
        dst = DST / name
        shutil.copy2(src, dst)
        print(f"[copy] {name}")


if __name__ == "__main__":
    process_magic_atoms()
    process_skins()
    copy_assets()
    print("done.")
