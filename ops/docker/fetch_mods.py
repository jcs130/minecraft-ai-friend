#!/usr/bin/env python3
"""按 modpack.json 备齐 ./mods（下载 + 从本地主服拷贝）。幂等：已存在且为合法 zip 则跳过。
用法: python fetch_mods.py [--force] [--copy-only]"""
import json, os, sys, shutil, urllib.request, pathlib, zipfile

HERE = pathlib.Path(__file__).resolve().parent
MODS = HERE / "mods"
MANIFEST = HERE / "modpack.json"
LOCAL_SERVER_MODS = HERE.parent.parent / "mc-server" / "mods"
UA = {"User-Agent": "mc-god-ops/1.0 (modpack fetch)"}


def fmt(n):
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f}{u}"
        n /= 1024
    return f"{n:.1f}TB"


def main():
    force = "--force" in sys.argv
    copy_only = "--copy-only" in sys.argv
    m = json.loads(MANIFEST.read_text(encoding="utf-8-sig"))
    MODS.mkdir(exist_ok=True)
    ok, fail = 0, []

    for e in m["download"]:
        if copy_only:
            continue
        dst = MODS / e["name"]
        if dst.exists() and zipfile.is_zipfile(dst) and not force:
            print(f"  = {e['name']} (cached, {fmt(dst.stat().st_size)})")
            ok += 1
            continue
        print(f"  v {e['name']} ({e['mod']} {e['ver']}) ...", flush=True)
        try:
            req = urllib.request.Request(e["url"], headers=UA)
            with urllib.request.urlopen(req, timeout=300) as r, open(dst, "wb") as f:
                shutil.copyfileobj(r, f)
            print(f"      done {fmt(dst.stat().st_size)}")
            ok += 1
        except Exception as ex:
            dst.unlink(missing_ok=True)
            print(f"      FAILED: {ex}")
            fail.append(e["name"])

    for name in m["copy_from_local_server"]:
        dst = MODS / name
        src = LOCAL_SERVER_MODS / name
        if dst.exists() and dst.stat().st_size > 0 and not force:
            print(f"  = {name} (cached)")
            ok += 1
            continue
        if not src.exists():
            print(f"  ! {name}: 本地主服没有此 jar（{src}）")
            fail.append(name)
            continue
        shutil.copy2(src, dst)
        print(f"  c {name} <- mc-server/mods ({fmt(dst.stat().st_size)})")
        ok += 1

    print(f"\n完成: {ok} ok, {len(fail)} failed" + (f" -> {fail}" if fail else ""))
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
