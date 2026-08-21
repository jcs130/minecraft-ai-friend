# -*- coding: utf-8 -*-
"""世界进程（天神化身，Node/TS）归位 → packaging/mc-world/assets/world/。

收集世界进程源码：bootstrap-world.mts + src/*.ts + tsconfig.json + package.json。
node_modules 不打包（better-sqlite3 为 native 模块跨平台必须重装、mineflayer 等依赖
首启 npm install）；package.json 补 tsx 依赖（世界进程跑 TS 必需）。
"""
import json
import shutil
from pathlib import Path

REPO = Path(r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend")
DST = REPO / "packaging" / "mc-world" / "assets" / "world"

TSX_VERSION = "^4.22.4"


def copy_ts(src: Path, dst: Path) -> int:
    """只复制 .ts / .mts 源码（跳过运行时产物）。"""
    n = 0
    for p in src.rglob("*"):
        if p.is_dir():
            continue
        if p.suffix not in (".ts", ".mts"):
            continue
        rel = p.relative_to(src)
        (dst / rel.parent).mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, dst / rel)
        n += 1
    return n


def main() -> None:
    if DST.exists():
        shutil.rmtree(DST)
    DST.mkdir(parents=True, exist_ok=True)

    # 1. 入口
    shutil.copy2(REPO / "bootstrap-world.mts", DST / "bootstrap-world.mts")

    # 2. src/*.ts
    n_src = copy_ts(REPO / "src", DST / "src")

    # 3. tsconfig
    shutil.copy2(REPO / "tsconfig.json", DST / "tsconfig.json")

    # 4. package.json：补 tsx 依赖，保留依赖清单供首启 npm install
    pkg = json.loads((REPO / "package.json").read_text(encoding="utf-8"))
    pkg.setdefault("dependencies", {})["tsx"] = TSX_VERSION
    (DST / "package.json").write_text(
        json.dumps(pkg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    # 5. 汇总
    total = sum(1 for f in DST.rglob("*") if f.is_file())
    print(f"[stage] world → {DST} ({total} files: 1 entry + {n_src} src + tsconfig + package.json)")
    print(f"  deps: {', '.join(sorted(pkg['dependencies'].keys()))}")


if __name__ == "__main__":
    main()
