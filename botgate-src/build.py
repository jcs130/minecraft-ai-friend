# -*- coding: utf-8 -*-
"""botgate 构建脚本（javac 全量 + 打 jar）。

用法：
    python botgate-src/build.py            # 编译全部 src -> 同目录
    python botgate-src/build.py --pack     # 编译 + 重打 botgate.jar
    python botgate-src/build.py --pack --deploy <mods_dir>   # 再拷到 mods 目录

classpath 复用 settlementsfix-src/javac-args-run.txt（同一套 MC/NeoForge 库）；
neoforge-server.jar 提到 mojang slim.jar 之前的逻辑与 settlementsfix 相同。
"""
import os
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SIB = os.path.join(os.path.dirname(HERE), "settlementsfix-src")
JDK = os.environ.get("JDK21_BIN", r"C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin")
JAVAC = os.path.join(JDK, "javac.exe" if os.name == "nt" else "javac")

FILES = [
    os.path.relpath(os.path.join(root, f), HERE).replace(os.sep, "/")
    for root, _dirs, files in os.walk(os.path.join(HERE, "dev"))
    for f in sorted(files)
    if f.endswith(".java")
]


def full_cp():
    with open(os.path.join(SIB, "javac-args-run.txt"), encoding="utf-8") as f:
        cp_raw = f.readline().split('-cp "', 1)[1].split('"', 1)[0]
    sep = ";" if ";" in cp_raw else ":"
    parts = [p for p in cp_raw.split(sep) if os.path.exists(p)]
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
    target = target or os.path.join(HERE, "botgate.jar")
    z = zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED)
    z.write(os.path.join(HERE, "botgate.mixins.json"), "botgate.mixins.json")
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
    compile_java(FILES, full_cp())
    t = pack()
    if "--deploy" in sys.argv:
        mods = sys.argv[sys.argv.index("--deploy") + 1]
        import shutil
        shutil.copy2(t, os.path.join(mods, "botgate.jar"))
        print("deployed ->", mods)


if __name__ == "__main__":
    main()
