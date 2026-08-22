# -*- coding: utf-8 -*-
"""苦力怕坑自动修复（2026-08-22 造物主谕）。
原理：读 Anvil region 的 sections block states → 每列最高非空气方块 = 地表高度。
  首次：众数法找坑（比 9x9 众数低 >=2 格）→ 修复 → 把修复后高度存基线。
  之后：与基线对比，低于基线 2+ 格 = 新炸的坑 → 修复（fill 填 dirt）。
用法：
  python terrain_repair.py --scan    # 扫描+众数法找坑，dry-run 打印（不执行）
  python terrain_repair.py --fix     # 执行修复（RCON fill）+ 更新基线
  python terrain_repair.py --check   # 对比基线找新坑，dry-run 打印
  python terrain_repair.py --check --fix   # 对比基线并执行修复
"""
import argparse
import gzip
import json
import os
import re
import struct
import sys
import zlib

WORLD = r"C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\scratch-plugin\mc-server-neoforge\world"
REGION_DIR = os.path.join(WORLD, "region")
BASELINE = r"C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\scratch-plugin\data\village\terrain-baseline.json"
RCON_HOST, RCON_PORT = "127.0.0.1", 25575
RCON_SECRET = r"C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\scratch-plugin\data\rcon-secret.txt"

CENTER_X, CENTER_Z = 3096, -1340
RADIUS = 24          # 扫描半径（村庄核心区，排除边缘自然地形）
HOLE_DROP = 2        # 比基准低多少判为坑
FILL_BLOCK = "minecraft:dirt"   # 填 dirt（草会自动蔓延成草方块）

# ---------------- NBT 最小解析 ----------------
def _nbt_value(tid, buf, off):
    if tid == 1:
        return buf[off], off + 1
    if tid == 2:
        return struct.unpack(">h", buf[off:off + 2])[0], off + 2
    if tid == 3:
        return struct.unpack(">i", buf[off:off + 4])[0], off + 4
    if tid == 4:
        return struct.unpack(">q", buf[off:off + 8])[0], off + 8
    if tid == 5:
        return struct.unpack(">f", buf[off:off + 4])[0], off + 4
    if tid == 6:
        return struct.unpack(">d", buf[off:off + 8])[0], off + 8
    if tid == 7:
        ln = struct.unpack(">i", buf[off:off + 4])[0]; off += 4
        return buf[off:off + ln], off + ln
    if tid == 8:
        ln = struct.unpack(">h", buf[off:off + 2])[0]; off += 2
        return buf[off:off + ln].decode("utf-8", "replace"), off + ln
    if tid == 9:
        et = buf[off]; ln = struct.unpack(">i", buf[off + 1:off + 5])[0]; off += 5
        items = []
        for _ in range(ln):
            v, off = _nbt_value(et, buf, off)
            items.append(v)
        return items, off
    if tid == 10:
        d = {}
        while True:
            sub_tid = buf[off]; off += 1
            if sub_tid == 0:
                break
            nlen = struct.unpack(">h", buf[off:off + 2])[0]; off += 2
            name = buf[off:off + nlen].decode("utf-8", "replace"); off += nlen
            v, off = _nbt_value(sub_tid, buf, off)
            d[name] = v
        return d, off
    if tid == 11:
        ln = struct.unpack(">i", buf[off:off + 4])[0]; off += 4
        vals = struct.unpack(">%di" % ln, buf[off:off + 4 * ln]) if ln else ()
        return list(vals), off + 4 * ln
    if tid == 12:
        ln = struct.unpack(">i", buf[off:off + 4])[0]; off += 4
        vals = struct.unpack(">%dq" % ln, buf[off:off + 8 * ln]) if ln else ()
        return list(vals), off + 8 * ln
    raise ValueError("unknown nbt tag %d" % tid)

def parse_nbt(buf):
    tid = buf[0]
    if tid != 10:
        raise ValueError("root not compound: %d" % tid)
    nlen = struct.unpack(">h", buf[1:3])[0]
    off = 3 + nlen
    v, _ = _nbt_value(10, buf, off)
    return v

# ---------------- region 解析 ----------------
def chunk_data(region_path, cx, cz):
    lcx, lcz = cx & 31, cz & 31
    idx = lcx + lcz * 32
    with open(region_path, "rb") as f:
        f.seek(idx * 4)
        loc = struct.unpack(">I", f.read(4))[0]
        if loc == 0:
            return None
        sec_off = (loc >> 8) * 4096
        f.seek(sec_off)
        ln = struct.unpack(">I", f.read(4))[0]
        ctype = f.read(1)[0]
        data = f.read(ln - 1)
    raw = None
    for fn in (lambda: zlib.decompress(data), lambda: zlib.decompress(data, -15), lambda: gzip.decompress(data)):
        try:
            raw = fn()
            break
        except Exception:
            continue
    if raw is None:
        raise ValueError("bad chunk compression %d" % ctype)
    return parse_nbt(raw)

def _block_at(data, idx, bits):
    """MC 1.18+ block data：每 long 固定 N=64//bits 个 entry，余位填充。"""
    per = 64 // bits
    li, wb = idx // per, (idx % per) * bits
    return (data[li] >> wb) & ((1 << bits) - 1)

def surface_map(root):
    """每列最高非空气方块 y → dict {(x,z): y}（MOTION_BLOCKING 语义，含水）。"""
    secs = {}
    for s in root.get("sections") or []:
        y = s.get("Y")
        if y is None:
            continue
        if y >= 128:
            y -= 256  # MC 存 section Y 带 +256 偏移（-4 -> 252）
        bs = s.get("block_states")
        if bs is None:
            secs[y] = (None, None, 0)
            continue
        pal = bs.get("palette") or []
        names = [p.get("Name", "minecraft:air") if isinstance(p, dict) else "minecraft:air" for p in pal]
        data = bs.get("data")
        bits = max(4, (len(names) - 1).bit_length()) if data else 0
        secs[y] = (names, data, bits)
    if not secs:
        return {}
    ymin = min(secs)
    ymax = max(secs)
    base_x, base_z = root.get("xPos", 0) << 4, root.get("zPos", 0) << 4
    out = {}
    for xo in range(16):
        for zo in range(16):
            h = None
            for sy in range(ymax, ymin - 1, -1):
                names, data, bits = secs.get(sy, (None, None, 0))
                if names is None:
                    continue
                if data is None:
                    # 全 palette[0]；隐式 air 时 palette[0]=air 或无方块
                    nm = names[0] if names else "minecraft:air"
                    if nm not in ("minecraft:air", "minecraft:cave_air"):
                        h = sy * 16 + 15
                        break
                    continue
                for yy in range(15, -1, -1):
                    idx = (yy * 16 + zo) * 16 + xo
                    pi = _block_at(data, idx, bits)
                    if pi == 0 and "minecraft:air" not in names:
                        continue  # 隐式 air
                    nm = names[pi] if pi < len(names) else "?"
                    if nm not in ("minecraft:air", "minecraft:cave_air"):
                        h = sy * 16 + yy
                        break
                if h is not None:
                    break
            if h is not None:
                out[(base_x + xo, base_z + zo)] = h
    return out

# ---------------- RCON ----------------
def _pkt(pid, ptype, body):
    d = struct.pack("<ii", pid, ptype) + body.encode("utf-8") + b"\x00\x00"
    return struct.pack("<i", len(d)) + d

def _rp(s):
    raw = b""
    while len(raw) < 4:
        c = s.recv(4 - len(raw))
        if not c:
            raise ConnectionError("closed")
        raw += c
    (ln,) = struct.unpack("<i", raw)
    d = b""
    while len(d) < ln:
        c = s.recv(ln - len(d))
        if not c:
            raise ConnectionError("closed")
        d += c
    return d[8:-2].decode("utf-8", "replace")

class Rcon:
    def __init__(self):
        self.s = None

    def cmd(self, c):
        import socket
        if self.s is None:
            pw = open(RCON_SECRET, encoding="utf-8-sig").read().strip()
            self.s = socket.create_connection((RCON_HOST, RCON_PORT), timeout=8)
            self.s.sendall(_pkt(1, 3, pw))
            _rp(self.s)
        try:
            self.s.sendall(_pkt(2, 2, c))
            return _rp(self.s)
        except Exception:
            self.s = None
            raise

# ---------------- 核心 ----------------
def load_heightmap(ax, az, bx, bz):
    h = {}
    for cx in range(ax >> 4, (bx >> 4) + 1):
        for cz in range(az >> 4, (bz >> 4) + 1):
            rx, rz = cx >> 5, cz >> 5
            path = os.path.join(REGION_DIR, "r.%d.%d.mca" % (rx, rz))
            if not os.path.exists(path):
                continue
            try:
                root = chunk_data(path, cx, cz)
            except Exception:
                continue
            if root is None:
                continue
            sm = surface_map(root)
            for (x, z), y in sm.items():
                if ax <= x <= bx and az <= z <= bz:
                    h[(x, z)] = y
    return h

def find_holes(h, baseline=None, drop=HOLE_DROP):
    if baseline:
        holes = []
        for (x, z), y in h.items():
            b = baseline.get((x, z))
            if b is not None and y <= b - drop:
                holes.append((x, z, y, b))
        return holes
    holes = []
    for (x, z), y in h.items():
        # 只检地面带（树/建筑顶部 76+ 与山谷 55- 不参与）
        if not (55 <= y <= 75):
            continue
        window = [h.get((xx, zz)) for xx in range(x - 4, x + 5) for zz in range(z - 4, z + 5)]
        window = [v for v in window if v is not None and 55 <= v <= 75]
        if len(window) < 20:
            continue
        freq = {}
        for v in window:
            freq[v] = freq.get(v, 0) + 1
        mode = max(freq, key=freq.get)
        if y <= mode - drop:
            holes.append((x, z, y, mode))
    return holes

def cluster_holes(holes):
    seen = set()
    clusters = []
    pts = {(x, z) for x, z, _, _ in holes}
    for (x, z, y, mode) in holes:
        if (x, z) in seen:
            continue
        stack = [(x, z)]
        seen.add((x, z))
        cells = []
        while stack:
            cx, cz = stack.pop()
            cells.append((cx, cz))
            for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nb = (cx + dx, cz + dz)
                if nb in pts and nb not in seen:
                    seen.add(nb)
                    stack.append(nb)
        if not cells:
            continue
        xs = [c[0] for c in cells]
        zs = [c[1] for c in cells]
        cellset = set(cells)
        yb = min(hh for hx, hz, hh, _ in holes if (hx, hz) in cellset)
        yt = max(mm for hx, hz, _, mm in holes if (hx, hz) in cellset)
        clusters.append((min(xs), min(zs), max(xs), max(zs), yb, yt, len(cells)))
    return clusters

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", action="store_true")
    ap.add_argument("--fix", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--baseline-only", action="store_true")
    ap.add_argument("--radius", type=int, default=RADIUS)
    ap.add_argument("--drop", type=int, default=HOLE_DROP)
    args = ap.parse_args()

    ax, az = CENTER_X - args.radius, CENTER_Z - args.radius
    bx, bz = CENTER_X + args.radius, CENTER_Z + args.radius
    h = load_heightmap(ax, az, bx, bz)
    if not h:
        print("no heightmap data")
        return 1
    print("scanned %d columns x[%d..%d] z[%d..%d]" % (len(h), ax, bx, az, bz))
    # 高度分布概览
    freq = {}
    for y in h.values():
        freq[y] = freq.get(y, 0) + 1
    top = sorted(freq.items(), key=lambda kv: -kv[1])[:6]
    print("height top:", top)

    baseline = {}
    if os.path.exists(BASELINE):
        try:
            raw = json.load(open(BASELINE, encoding="utf-8"))
            baseline = {(int(k.split(",")[0]), int(k.split(",")[1])): v for k, v in raw.items()}
        except Exception:
            baseline = {}

    if args.baseline_only:
        baseline = {"%d,%d" % p: v for p, v in h.items()}
        json.dump(baseline, open(BASELINE, "w", encoding="utf-8"), ensure_ascii=False)
        print("baseline saved (current state):", BASELINE)
        return 0

    if args.check and baseline:
        holes = find_holes(h, baseline, args.drop)
        mode = "check-vs-baseline"
    else:
        holes = find_holes(h, None, args.drop)
        mode = "mode-based(首次)"

    clusters = cluster_holes(holes)
    print("mode=%s  cells=%d  clusters=%d" % (mode, len(holes), len(clusters)))
    if not clusters:
        print("no holes")
        return 0

    cmds = []
    for (x1, z1, x2, z2, yb, yt, n) in clusters:
        bot = yb + 1
        top = yt - 1
        if top >= bot:
            cmd = "fill %d %d %d %d %d %d %s replace air" % (x1, bot, z1, x2, top, z2, FILL_BLOCK)
            cmds.append(cmd)
            print("HOLE bbox=(%d,%d)-(%d,%d) y=%d..%d cells=%d -> %s" % (x1, z1, x2, z2, bot, top, n, cmd[:80]))

    if args.fix:
        r = Rcon()
        ok = 0
        for c in cmds:
            try:
                out = r.cmd(c)
                if out:
                    ok += 1
                print("  ok:", c[:70], "|", (out or "")[:40])
            except Exception as e:
                print("  err:", c[:70], e)
        print("executed %d/%d" % (ok, len(cmds)))
        h2 = load_heightmap(ax, az, bx, bz)
        baseline = {"%d,%d" % p: v for p, v in h2.items()}
        json.dump(baseline, open(BASELINE, "w", encoding="utf-8"), ensure_ascii=False)
        print("baseline saved:", BASELINE)
    else:
        print("dry-run：加 --fix 执行修复并保存基线")

    return 0

if __name__ == "__main__":
    sys.exit(main())
