#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_client_pack.py — 千灯纪客户端资源包打包器（2026-08-29）

把服务端 mods 里「客户端需要装」的 jar 筛出来，连同安装说明打成 zip，
放进网关 data/downloads/ 供 /download 页面分发。

筛选口径（与 mc_gateway.jar_meta 同逻辑）：
- side == "SERVER"（无 client 代码、未定义实体同步、或依赖声明 SERVER）→ 跳过
- 其余（BOTH / 带 client 代码 / 定义实体同步）→ 客户端必装
- 语音链路附加包（god-voice 等）自动包含（它们本来就是 client/BOTH）

用法：
  python build_client_pack.py            # 打包 + 打印清单
  python build_client_pack.py --dry      # 只打印分类，不写 zip
"""
import os, sys, zipfile, tomllib, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
MODS_DIR = os.path.normpath(os.path.join(HERE, "..", "ops", "docker", "shadow", "mods"))
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "ops", "docker", "shadow", "data", "downloads"))
MC_VERSION = "1.21.1"
NEOFORGE_VERSION = "21.1.248"

README = f"""千灯纪 · 客户端安装包（自动生成 {datetime.date.today()}）
==============================================

【你需要做的事，一共 3 步】

第 1 步：安装 NeoForge（客户端版）
  双击 neoforge-{NEOFORGE_VERSION}-installer.jar
  → 选「Install client」→ 确认（需要先装好官方 Minecraft Java {MC_VERSION} 一次）

第 2 步：把 mods 文件夹里的所有 .jar
  放进 Minecraft 目录的 mods 文件夹
  （游戏内「选项→资源包」旁边找不到的话：
   Win+R 输入 %appdata%\\.minecraft 回车，把 jar 都丢进 mods 文件夹）

第 3 步：启动器选择「neoforge-{MC_VERSION}」配置文件，进多人游戏，服务器地址：
  局域网：  127.0.0.1:25565  或  <这台电脑的局域网IP>:25565
  （端口 25565 是真人直连口，别用 25599，那是 AI 专用口）

【这个包里有什么】
  neoforge-{NEOFORGE_VERSION}-installer.jar  —— NeoForge 安装器（第 1 步用）
  mods/*.jar                       —— 服务端同款模组（第 2 步用）
  README.txt                       —— 本说明

【常见问题】
  Q: 进服被踢「Missing mods / 不匹配」？
  A: 说明服务端刚更新了模组，重新下载本包覆盖 mods 即可。
  Q: 想听角色说话？
  A: 包里已带语音模组，进服后耳机音量开好就行。
"""

def jar_meta(path):
    """与 mc_gateway.jar_meta 同口径：返回 side 判定所需的 (server_only, client_code)。"""
    server_only, client_code = False, False
    try:
        z = zipfile.ZipFile(path)
        tomls = [n for n in z.namelist() if n.lower().endswith(("neoforge.mods.toml", "mods.toml", "fml.toml"))]
        for pref in ("META-INF/neoforge.mods.toml", "META-INF/mods.toml", "neoforge.mods.toml"):
            if pref in tomls:
                data = tomllib.loads(z.read(pref).decode("utf-8", "ignore"))
                deps = data.get("dependencies", {})
                if any(v.get("side") == "SERVER" for v in deps.values() if isinstance(v, dict)):
                    server_only = True
                break
        for n in z.namelist():
            if not n.endswith(".class"):
                continue
            try:
                b = z.read(n)
            except Exception:
                continue
            if b"net/minecraft/client" in b:
                client_code = True
                break
    except Exception:
        pass
    return server_only, client_code

def main():
    dry = "--dry" in sys.argv
    if not os.path.isdir(MODS_DIR):
        print(f"[!] mods 目录不存在: {MODS_DIR}")
        return 1
    jars = sorted(f for f in os.listdir(MODS_DIR) if f.lower().endswith(".jar"))
    # 口径（2026-08-29 造物主定）：客户端包=服务端全量 mods。
    # 启发式筛 side 会误伤（反射/配置里的 client 引用致误报），而多装 server 优化类
    # （spark/chunky/lithium…）对客户端无害；全量=直连协商永不缺 mod，玩家零挑选。
    client_needed = jars
    skipped = []
    print(f"服务端 mods 共 {len(jars)}，客户端需装 {len(client_needed)}，跳过 {len(skipped)}：")
    for fn in skipped:
        print(f"  [跳过] {fn}")
    print("  [必装] " + "\n  [必装] ".join(client_needed))
    if dry:
        return 0

    os.makedirs(OUT_DIR, exist_ok=True)
    stamp = datetime.date.today().strftime("%Y%m%d")
    out = os.path.join(OUT_DIR, f"qiandeng-client-pack-{MC_VERSION}-{stamp}.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:  # jar 已压缩，外层 STORED 快
        z.writestr("README.txt", README)
        z.writestr("mods/PLACEHOLDER.txt", "把本文件夹内所有 .jar 复制到 .minecraft/mods/\n")
        for fn in client_needed:
            z.write(os.path.join(MODS_DIR, fn), f"mods/{fn}")
        # NeoForge 安装器随包（若已下载到 downloads/）
        installer = os.path.join(OUT_DIR, f"neoforge-{NEOFORGE_VERSION}-installer.jar")
        if os.path.isfile(installer):
            z.write(installer, f"neoforge-{NEOFORGE_VERSION}-installer.jar")
    print(f"\n[OK] {out} ({os.path.getsize(out)//1024} KB)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
