# -*- coding: utf-8 -*-
"""settlementsfix 构建脚本（javac 全量 + 打 jar）。

用法：
    python settlementsfix-src/build.py            # 编译全部 src -> classes（同目录）
    python settlementsfix-src/build.py --pack     # 编译 + 重打 settlementsfix.jar
    python settlementsfix-src/build.py --pack --deploy <mods_dir>   # 再拷到 mods 目录

classpath 从 javac-args-run.txt 取全量 MC/NeoForge 库；把 neoforge-server.jar
（官方映射名）提到 mojang slim.jar（部分名不可读）之前——否则 MinecraftServer
.getCommands/.getPlayerList 等官方名解析不到（javac 按 cp 顺序取第一个类定义）。

CI 模式（无 MC 库环境）：--pure-only 只编纯逻辑三件（Layout/IO/Test），classpath
仅 gson（CI 从 maven central 拉，见 .github/workflows/ci.yml）。
"""
import os
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
JDK = os.environ.get("JDK21_BIN", r"C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin")
# 平台自适应（2026-08-30 CI 红根因③）：Linux CI 无 javac.exe——.exe 只在 Windows 拼。
JAVAC = os.path.join(JDK, "javac.exe" if os.name == "nt" else "javac")

PURE = [
    "dev/god/settlementsfix/chest/SkillChestLayout.java",
    "dev/god/settlementsfix/chest/SkillChestIO.java",
    "dev/god/settlementsfix/chest/SkillChestTest.java",
]
FULL = PURE + [
    "dev/god/settlementsfix/chest/SkillChestMenu.java",
    "dev/god/settlementsfix/chest/SkillWheelMenu.java",
    "dev/god/settlementsfix/chest/SkillChestCommands.java",
] + [
    # dev/god/settlementsfix 全树 .java 扫描（2026-08-30 两步演进：FULL 手列漏新
    # mixin 致崩循环 ~10 分钟→当日再改全树——chest/magic/mixin 新目录免登记）。
    # 例外：依赖 settlements mod 类（dev.breezes.*）的源不在本 cp，编不了——
    # 其历史 .class 由 pack() 全目录扫描带进 jar。
    os.path.relpath(os.path.join(root, f), HERE).replace(os.sep, "/")
    for root, _dirs, files in os.walk(os.path.join(HERE, "dev/god/settlementsfix"))
    for f in sorted(files)
    if f.endswith(".java") and f not in ("BubblePublishGuardMixin.java",)
]


def full_cp():
    with open(os.path.join(HERE, "javac-args-run.txt"), encoding="utf-8") as f:
        cp_raw = f.readline().split('-cp "', 1)[1].split('"', 1)[0]
    sep = ";" if ";" in cp_raw else ":"
    parts = cp_raw.split(sep)
    neo = [p for p in parts if "neoforge-21.1.73-server.jar" in p]
    rest = [p for p in parts if "neoforge-21.1.73-server.jar" not in p]
    slim_idx = next((i for i, p in enumerate(rest) if p.endswith("-slim.jar")), None)
    if neo and slim_idx is not None:
        rest[slim_idx:slim_idx] = neo
    return sep.join(rest)


def compile_java(files, cp):
    cmd = [JAVAC, "-proc:none", "--release", "21", "-encoding", "UTF-8",
           "-cp", cp, "-d", HERE] + [os.path.join(HERE, f) for f in files]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        sys.stdout.write(r.stdout[:4000] + "\n")
        sys.stderr.write(r.stderr[:6000] + "\n")
        raise SystemExit("javac failed: %d" % r.returncode)
    print("compiled %d files" % len(files))


def pack(target=None):
    import time
    import shutil
    target = target or os.path.join(HERE, "settlementsfix.jar")
    if os.path.exists(target):
        shutil.copy2(target, target + ".bak-" + time.strftime("%m%d-%H%M"))
    z = zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED)
    z.write(os.path.join(HERE, "settlementsfix.mixins.json"), "settlementsfix.mixins.json")
    z.write(os.path.join(HERE, "build-121", "neoforge.mods.toml"), "META-INF/neoforge.mods.toml")
    n = 0
    for root, _, files in os.walk(os.path.join(HERE, "dev")):
        for f in files:
            if f.endswith(".class"):
                p = os.path.join(root, f)
                z.write(p, os.path.relpath(p, HERE).replace(os.sep, "/"))
                n += 1
    z.close()
    print("jar: %s (%d classes)" % (target, n))
    return target


def main():
    pure_only = "--pure-only" in sys.argv
    do_pack = "--pack" in sys.argv
    if pure_only:
        # CI：无 MC 库，只有 gson 在 cwd（gson-*.jar）
        import glob
        gson = glob.glob(os.path.join(os.getcwd(), "gson-*.jar"))
        cp = os.pathsep.join(gson)
        compile_java(PURE, cp)
        java = os.path.join(JDK, "java.exe" if os.name == "nt" else "java")
        r = subprocess.run([java, "-cp", cp + os.pathsep + HERE,
                            "dev.god.settlementsfix.chest.SkillChestTest"],
                           capture_output=True, timeout=300)
        out = r.stdout.decode("utf-8", errors="replace")
        sys.stdout.write(out + "\n")
        if r.returncode != 0:
            sys.stderr.write(r.stderr.decode("utf-8", errors="replace")[:2000] + "\n")
            raise SystemExit("SkillChestTest failed")
        return
    compile_java(FULL, full_cp())
    if do_pack:
        t = pack()
        if "--deploy" in sys.argv:
            mods = sys.argv[sys.argv.index("--deploy") + 1]
            import shutil
            shutil.copy2(t, os.path.join(mods, "settlementsfix.jar"))
            print("deployed ->", mods)


if __name__ == "__main__":
    main()
