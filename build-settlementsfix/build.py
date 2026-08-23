#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""settlementsfix mod 一键构建脚本（2026-08-23 沉淀，替换已丢失的 ops/build-settlementsfix.py）。

自洽流程（不依赖 pkg 残留二进制）：
  1. 全量编译 src/ 下所有 .java（主类 + 4 mixin）到干净的 pkg/
  2. 复制 src/META-INF/neoforge.mods.toml + src/settlementsfix.mixins.json 到 pkg/
  3. 打包 dist/settlementsfix.jar

classpath = 全量 NeoForge libraries（packaging/mc-world/assets/mc-server/libraries）
          + mojmap minecraft-merged jar（numen-reference loom-cache）
          + 全量 fabric remapped mods（numen-reference loom-cache/remapped_mods）
          + settlements-1.0.0-beta.1.jar（mixin 目标类 dev.breezes.settlements.* 所在）
因为 mojmap ServerPlayer 等类经 fabric data-attachment API 织入接口，缺任一 jar 都会
报「找不到 net.neoforged.bus.api / net.fabricmc.fabric.api.attachment / com.mojang.brigadier」等。
用 javac @argfile 传 classpath，避免 Windows 命令行 8191 字符上限。
-proc:none 禁用 mixin 注解处理器（AP 校验需 refmap 映射，会阻塞编译），mixin 类照常编译成 class。

用法：用干净 Python311 跑（本机 PYTHONHOME 被 uv 劫持，勿用默认 python）。
  C:\\Users\\lzl19\\AppData\\Local\\Programs\\Python\\Python311\\python.exe build.py
"""
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
LIBS = r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\packaging\mc-world\assets\mc-server\libraries"
MERGED = r"C:\Users\lzl19\.copaw\workspaces\default\numen-reference\.gradle\loom-cache\minecraftMaven\net\minecraft\minecraft-merged-48f5f74c97\1.21.1-loom.mappings.1_21_1.layered+hash.2198-v2\minecraft-merged-48f5f74c97-1.21.1-loom.mappings.1_21_1.layered+hash.2198-v2.jar"
FABRIC = r"C:\Users\lzl19\.copaw\workspaces\default\numen-reference\.gradle\loom-cache\remapped_mods\remapped"
SETTLEMENTS = r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\packaging\mc-world\assets\mc-server\mods\settlements-1.0.0-beta.1.jar"
JAVAC = r"C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin\javac.exe"
JAR = r"C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin\jar.exe"


def collect_jars(base, skip_sources=False):
    out = []
    for root, _dirs, files in os.walk(base):
        for f in files:
            if not f.endswith(".jar"):
                continue
            if skip_sources and "sources" in f:
                continue
            out.append(os.path.join(root, f))
    return out


def main():
    jars = collect_jars(LIBS)
    jars.append(MERGED)
    jars.extend(collect_jars(FABRIC, skip_sources=True))
    jars.append(SETTLEMENTS)

    src_dir = os.path.join(ROOT, "src")
    srcs = []
    for root, _dirs, files in os.walk(src_dir):
        for f in files:
            if f.endswith(".java"):
                srcs.append(os.path.join(root, f))

    pkg = os.path.join(ROOT, "pkg")
    if os.path.isdir(pkg):
        shutil.rmtree(pkg)
    os.makedirs(os.path.join(pkg, "META-INF"), exist_ok=True)

    argfile = os.path.join(ROOT, "compile-args.txt")
    with open(argfile, "w", encoding="utf-8") as fp:
        fp.write("-encoding\nUTF-8\n")
        fp.write("-proc:none\n")  # 禁 mixin AP（校验需 refmap），mixin 类照常编译
        fp.write("-cp\n" + ";".join(jars) + "\n")
        fp.write("-d\n" + pkg + "\n")
        for s in srcs:
            fp.write(s + "\n")

    print(f"[build] jars={len(jars)} srcs={len(srcs)}")
    ret = subprocess.run([JAVAC, "@" + argfile], cwd=ROOT)
    if ret.returncode != 0:
        print(f"[build] COMPILE_FAIL={ret.returncode}")
        sys.exit(ret.returncode)
    print("[build] COMPILE_OK")

    # 复制 mod 配置进 pkg（打包前）
    shutil.copy(os.path.join(src_dir, "META-INF", "neoforge.mods.toml"),
                os.path.join(pkg, "META-INF", "neoforge.mods.toml"))
    shutil.copy(os.path.join(src_dir, "settlementsfix.mixins.json"),
                os.path.join(pkg, "settlementsfix.mixins.json"))

    dist_dir = os.path.join(ROOT, "dist")
    os.makedirs(dist_dir, exist_ok=True)
    out_jar = os.path.join(dist_dir, "settlementsfix.jar")
    ret = subprocess.run([JAR, "cf", out_jar, "-C", pkg, "."], cwd=ROOT)
    if ret.returncode != 0:
        print(f"[build] PACK_FAIL={ret.returncode}")
        sys.exit(ret.returncode)
    size = os.path.getsize(out_jar)
    print(f"[build] PACK_OK size={size}")
    sys.exit(0)


if __name__ == "__main__":
    main()
