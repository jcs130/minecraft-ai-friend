# -*- coding: utf-8 -*-
"""MC 服务端「干净归位」→ packaging/mc-world/assets/mc-server/。

从部署现场 mc-server-neoforge 收集最小可启动集（NeoForge 21.1.73 标准安装）：
  libraries/           NeoForge 运行时（约 175MB，必需）
  mods/                全部启用 jar（剔除 *.disabled / *.bak* / 误放的 META-INF）
  config/              全部 mod 配置（numen_api-common.toml 的 LLM 端点留待 backend 启动时注入）
  run.bat / run.sh / user_jvm_args.txt / eula.txt
  server.properties    清理后（port→25565、motd→分发版、rcon.password→占位符）

不含：world（首启自动生成）、logs / crash-reports / usercache / database.db 等运行态垃圾。

可复跑（幂等：先清空目标再收集）。
"""
import os
import re
import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent  # B 仓根（minecraft-ai-friend）
# A 仓（deepseek-harness）默认与 B 仓同挂 workspaces\default\ 下，可经 MC_HARNESS_ROOT 覆盖
HARNESS = Path(os.environ.get("MC_HARNESS_ROOT", REPO.parent / "deepseek-harness"))
SRC = HARNESS / "scratch-plugin" / "mc-server-neoforge"
DST = REPO / "packaging" / "mc-world" / "assets" / "mc-server"

RCON_PLACEHOLDER = "__MC_WORLD_RCON__"  # backend 首启随机化
NEOFORGE_VER = "21.1.73"                 # 与 libraries/.../neoforge/{ver} 一致


def size_mb(p: Path) -> float:
    if not p.exists():
        return 0.0
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) / 1e6


def copy_files(src_root: Path, dst_root: Path, skip=None) -> int:
    """复制 src_root 下所有文件到 dst_root，保留相对结构；返回复制文件数。"""
    n = 0
    for p in src_root.rglob("*"):
        if p.is_dir():
            continue
        if skip and skip(p):
            continue
        rel = p.relative_to(src_root)
        (dst_root / rel.parent).mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, dst_root / rel)
        n += 1
    return n


def skip_mod(p: Path) -> bool:
    n = p.name.lower()
    parts_lower = {x.lower() for x in p.parts}
    # roadweaver: client_side:required + 10 个非 optional 地图 payload，强制客户端装 NeoForge，
    # 会拒绝 vanilla 客户端（mineflayer 假玩家 + 真人 vanilla 客户端都连不进）。分发版剔除。
    return (n.endswith(".disabled") or ".bak" in n or "meta-inf" in parts_lower
            or "roadweaver" in n)


def main() -> None:
    # 1. 幂等清空
    if DST.exists():
        shutil.rmtree(DST)
    DST.mkdir(parents=True, exist_ok=True)

    # 2. libraries（NeoForge 运行时，完整）
    n_lib = copy_files(SRC / "libraries", DST / "libraries")

    # 3. mods（剔 .disabled / .bak / META-INF）
    n_mod = copy_files(SRC / "mods", DST / "mods", skip=skip_mod)

    # 4. config（完整）
    n_cfg = copy_files(SRC / "config", DST / "config")

    # 5. 启动脚本 + eula
    for name in ("run.bat", "run.sh", "user_jvm_args.txt", "eula.txt"):
        shutil.copy2(SRC / name, DST / name)

    # 6. server.properties 清理
    props = (SRC / "server.properties").read_text(encoding="utf-8")
    props = re.sub(r"^server-port=.*$", "server-port=25599", props, flags=re.M)
    props = re.sub(r"^motd=.*$", "motd=MC 异世界 | AI 原住民 | NeoForge 1.21.1", props, flags=re.M)
    props = re.sub(r"^rcon\.password=.*$", f"rcon.password={RCON_PLACEHOLDER}", props, flags=re.M)
    (DST / "server.properties").write_text(props, encoding="utf-8")

    # 7. 汇总
    print(f"[stage] mc-server → {DST}")
    print(f"  libraries      {size_mb(DST / 'libraries'):>8.1f} MB  ({n_lib} files)")
    print(f"  mods           {size_mb(DST / 'mods'):>8.1f} MB  ({n_mod} files)")
    print(f"  config         {size_mb(DST / 'config'):>8.1f} MB  ({n_cfg} files)")
    print(f"  ──────────────────────────────")
    print(f"  total          {size_mb(DST):>8.1f} MB")
    print(f"  (不含 world 存档，首启自动生成)")


if __name__ == "__main__":
    main()
