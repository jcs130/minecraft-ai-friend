#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
guard_summarize.py — 守卫桥「运行档案 + 记录总结」功能（纯规则，无 LLM）

读取守卫桥事件级记录 data/guard-drive-{tag}.jsonl（feed_append 写的 {ts,kind,name,text}），
聚合成行为统计，并**结构化归档**为「守卫运行档案库」，供分析运行情况 + 作为学习闭环（反思迭代）数据输入。

档案库结构（data/guard-analytics/）：
    snapshots/{YYYY-MM-DD}-{tag}.json   单次快照（完整统计，不覆盖，可追溯）
    index.json                          指标序列（每次快照追加一条，跨日趋势）
    reports/{YYYY-MM-DD}.md             当日报告（两守卫对比 + 趋势判断）
    reflections/{tag}.md                守卫反思日志（女神用 learn/self-improvement 技能写，脚本不生成内容）

用法：
    # 快速单次统计（打印 + 写 data/guard-summary-{tag}.md，与旧版一致）
    python guard_summarize.py --tag kirito,naruto --tail 8
    # 归档快照 + 更新 index + 生成报告（推荐，分析/闭环走这个）
    python guard_summarize.py --tag kirito,naruto --tail 8 --archive
    # 只看趋势（归档后高效：读 snapshots/index，不需重读原始 jsonl 除非 --refresh）
    python guard_summarize.py --trend

Windows 终端默认 GBK，⚠️ emoji 会 UnicodeEncodeError → 脚本已 reconfigure stdout 为 UTF-8；
跑时仍建议 set PYTHONIOENCODING=utf-8。
"""
import json
import os
import re
import sys
import time
import collections
import argparse

# Windows 终端默认 GBK → 强制 UTF-8 避免 emoji/中文报错
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DATA = os.path.join(REPO_ROOT, "data")
ARCHIVE = os.path.join(DATA, "guard-analytics")
SNAP_DIR = os.path.join(ARCHIVE, "snapshots")
REPORT_DIR = os.path.join(ARCHIVE, "reports")
REFLECT_DIR = os.path.join(ARCHIVE, "reflections")
INDEX = os.path.join(ARCHIVE, "index.json")


def _ensure():
    for d in (ARCHIVE, SNAP_DIR, REPORT_DIR, REFLECT_DIR):
        os.makedirs(d, exist_ok=True)


def load_lines(tag):
    p = os.path.join(DATA, f"guard-drive-{tag}.jsonl")
    if not os.path.isfile(p):
        return None, []
    rows = []
    with open(p, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                rows.append({"ts": "", "kind": "raw", "name": tag, "text": line[:400]})
    return p, rows


def parse_tool(text):
    if not text:
        return None
    m = re.search(r'"tool"\s*:\s*"([^"]+)"', text)
    if m:
        return m.group(1)
    m = re.search(r"tool\s*=\s*([A-Za-z_]+)", text)
    if m:
        return m.group(1)
    return None


def _span(a, b):
    if not a or not b:
        return ""
    try:
        ta = time.mktime(time.strptime(a, "%Y-%m-%d %H:%M:%S"))
        tb = time.mktime(time.strptime(b, "%Y-%m-%d %H:%M:%S"))
        d = tb - ta
        if d < 3600:
            return f"{d/60:.0f} 分钟"
        if d < 86400:
            return f"{d/3600:.1f} 小时"
        return f"{d/86400:.1f} 天"
    except Exception:
        return ""


def summarize(tag, tail=8):
    p, rows = load_lines(tag)
    if p is None:
        return None
    kind_cnt = collections.Counter()
    tool_cnt = collections.Counter()
    maxit_cnt = 0
    stall_cnt = 0
    error_cnt = 0
    blocked_cnt = 0
    first_ts = last_ts = None
    for r in rows:
        ts = r.get("ts", "")
        if ts:
            if first_ts is None or ts < first_ts:
                first_ts = ts
            if last_ts is None or ts > last_ts:
                last_ts = ts
        k = r.get("kind", "raw")
        kind_cnt[k] += 1
        text = r.get("text", "") or ""
        if "maximum number of iterations" in text or "max iterations" in text:
            maxit_cnt += 1
        if k == "stall":
            stall_cnt += 1
        if k == "error":
            error_cnt += 1
        if k == "blocked":
            blocked_cnt += 1
        tool = parse_tool(text)
        if tool:
            tool_cnt[tool] += 1
    recent = rows[-tail:] if tail else []
    return {
        "tag": tag,
        "file": os.path.basename(p),
        "total": len(rows),
        "first_ts": first_ts,
        "last_ts": last_ts,
        "span": _span(first_ts, last_ts),
        "kind_cnt": dict(kind_cnt),
        "tool_cnt": dict(tool_cnt),
        "maxit_cnt": maxit_cnt,
        "stall_cnt": stall_cnt,
        "error_cnt": error_cnt,
        "blocked_cnt": blocked_cnt,
        "tail": [
            {"ts": r.get("ts", ""), "kind": r.get("kind", "raw"),
             "text": (r.get("text", "") or "")[:160]}
            for r in recent
        ],
        "gen_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def render_md(s):
    L = []
    L.append(f"# 守卫行为统计：{s['tag']}")
    L.append("")
    L.append(f"- 文件：`{s['file']}`　总记录：**{s['total']}** 条")
    L.append(f"- 时间跨度：`{s['first_ts']} ~ {s['last_ts']}`（{s['span']}）")
    L.append(f"- ⚠️ 卡死(max iterations)：**{s['maxit_cnt']}** 次")
    L.append(f"- ⚠️ 任务卡住(stall) ：**{s['stall_cnt']}** 次")
    L.append(f"- ⚠️ 异常(error)　　：**{s['error_cnt']}** 次")
    L.append(f"- ⚠️ 阻塞(blocked)　：**{s['blocked_cnt']}** 次")
    L.append("")
    L.append("## kind 分布")
    for k, c in s["kind_cnt"].items():
        L.append(f"- `{k}`：{c}")
    L.append("")
    L.append("## 动作工具分布")
    if s["tool_cnt"]:
        for t, c in sorted(s["tool_cnt"].items(), key=lambda x: -x[1]):
            L.append(f"- `{t}`：{c}")
    else:
        L.append("（无）")
    L.append("")
    L.append("## 最近行为")
    for r in s["tail"]:
        short = r["text"].replace("\n", " ").strip()
        L.append(f"`{r['ts']}` **[{r['kind']}]** {short}")
    L.append("")
    return "\n".join(L)


# ---------------- 归档/趋势/报告（分析运行情况 + 学习闭环数据） ----------------

def archive_snapshot(s):
    """写 snapshots/{date}-{tag}.json（不覆盖，可追溯）。"""
    _ensure()
    date = time.strftime("%Y-%m-%d")
    path = os.path.join(SNAP_DIR, f"{date}-{s['tag']}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(s, f, ensure_ascii=False, indent=2)
    return path


def append_index(s):
    """把本快照的关键指标追加进 index.json（跨日趋势数据源）。"""
    _ensure()
    date = time.strftime("%Y-%m-%d")
    entries = []
    if os.path.isfile(INDEX):
        try:
            with open(INDEX, encoding="utf-8") as f:
                entries = json.load(f).get("entries", [])
        except Exception:
            entries = []
    entry = {
        "date": date,
        "ts": s["gen_at"],
        "tag": s["tag"],
        "total": s["total"],
        "span": s["span"],
        "maxit": s["maxit_cnt"],
        "stall": s["stall_cnt"],
        "error": s["error_cnt"],
        "blocked": s["blocked_cnt"],
        "maxit_rate": round(s["maxit_cnt"] / s["total"], 4) if s["total"] else 0,
        "top_tool": (sorted(s["tool_cnt"].items(), key=lambda x: -x[1])[0][0]
                     if s["tool_cnt"] else ""),
    }
    # 同一天同 tag 只保留一条（更新），避免重复日期堆叠
    entries = [e for e in entries if not (e.get("date") == date and e.get("tag") == s["tag"])]
    entries.append(entry)
    entries.sort(key=lambda e: (e.get("date", ""), e.get("tag", "")))
    with open(INDEX, "w", encoding="utf-8") as f:
        json.dump({"entries": entries}, f, ensure_ascii=False, indent=2)
    return entry


def load_index():
    if not os.path.isfile(INDEX):
        return []
    try:
        with open(INDEX, encoding="utf-8") as f:
            return json.load(f).get("entries", [])
    except Exception:
        return []


def trend_for(tag, entries):
    """该 tag 的按日期指标序列 + 卡死率趋势。"""
    rows = [e for e in entries if e.get("tag") == tag]
    rows.sort(key=lambda e: e.get("date", ""))
    out = []
    for e in rows:
        out.append((e.get("date", ""), e.get("total", 0), e.get("maxit", 0),
                    e.get("maxit_rate", 0), e.get("error", 0), e.get("top_tool", "")))
    return out


def render_report(tags, entries):
    L = []
    L.append(f"# 守卫运行报告　`{time.strftime('%Y-%m-%d %H:%M:%S')}`")
    L.append("")
    L.append("> 数据源：`data/guard-drive-*.jsonl` → 快照 `guard-analytics/snapshots/` → 指标 `index.json`。")
    L.append("> 反思/学习闭环入口：`guard-analytics/reflections/{tag}.md`（女神用 learn/self-improvement 技能维护）。")
    L.append("")
    for tag in tags:
        s = summarize(tag)
        if s is None:
            L.append(f"## {tag}：无记录")
            continue
        L.append(f"## {tag}（{s['span']}，总 {s['total']} 条）")
        L.append("")
        L.append(f"-⚠️ 卡死 **{s['maxit_cnt']}** 次　卡死率 **{s['maxit_cnt']/s['total']*100:.2f}%**　stall {s['stall_cnt']}　error {s['error_cnt']}　blocked {s['blocked_cnt']}")
        L.append("")
        L.append("### 动作工具 top8")
        for t, c in sorted(s["tool_cnt"].items(), key=lambda x: -x[1])[:8]:
            L.append(f"- `{t}`：{c}")
        L.append("")
        L.append("### 卡死率趋势（跨日）")
        trend = trend_for(tag, entries)
        if trend:
            for (dt, total, maxit, rate, err, top) in trend:
                L.append(f"- {dt}：总 {total}，卡死 {maxit}（{rate*100:.2f}%），err {err}，top `{top}`")
        else:
            L.append("（暂无历史快照，跑 --archive 积累）")
        L.append("")
    L.append("---")
    L.append("")
    L.append("## 学习闭环：给女神的反思入口")
    L.append("")
    L.append("- 守卫桥只出**客观数据**（本脚本聚合）；**语义反思 + 触发优化**归女神（learn/self-improvement 技能）。")
    L.append("- 每次复盘：读本报告 + snapshots + raw jsonl → 提炼守卫经验条目 → `reflections/{tag}.md` + LESSONS.md。")
    L.append("- 同一问题**重复 3 次**才确认为规则（不从沉默推断），据此调守卫 prompt / 策略 / 升级守卫 skill。")
    L.append("")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="kirito,naruto", help="逗号分隔守卫 tag")
    ap.add_argument("--tail", type=int, default=8)
    ap.add_argument("--out", default="md", choices=["md", "json", "both"])
    ap.add_argument("--archive", action="store_true",
                    help="归档快照 + 更新 index + 生成当日报告（分析/学习闭环走这个）")
    ap.add_argument("--trend", action="store_true", help="只看 index 趋势（不重读原始 jsonl）")
    args = ap.parse_args()
    tags = [t.strip() for t in args.tag.split(",") if t.strip()]

    if args.trend:
        entries = load_index()
        for tag in tags:
            print(f"== {tag} 卡死率趋势 ==", flush=True)
            trend = trend_for(tag, entries)
            if not trend:
                print("（暂无数据）", flush=True)
            for (dt, total, maxit, rate, err, top) in trend:
                print(f"{dt}: 总{total} 卡死{maxit}({rate*100:.2f}%) err{err} top@{top}", flush=True)
            print("", flush=True)
        return

    summaries = {}
    for tag in tags:
        s = summarize(tag)
        if s is None:
            print(f"[guard-summarize] 未找到 {tag} 记录，跳过。", flush=True)
            continue
        summaries[tag] = s
        if args.out in ("md", "both"):
            print(render_md(s), flush=True)
            print("\n" + "-" * 60 + "\n", flush=True)
            out = os.path.join(DATA, f"guard-summary-{tag}.md")
            with open(out, "w", encoding="utf-8") as f:
                f.write(render_md(s))
            print(f"[summary] {tag} → {out}", flush=True)
        if args.out in ("json", "both"):
            outj = os.path.join(DATA, f"guard-summary-{tag}.jsonl")
            with open(outj, "w", encoding="utf-8") as f:
                f.write(json.dumps(s, ensure_ascii=False) + "\n")
            print(f"[summary] {tag} → {outj}", flush=True)

    if args.archive and summaries:
        for tag, s in summaries.items():
            snap = archive_snapshot(s)
            idx = append_index(s)
            print(f"[archive] {tag} 快照 → {snap}　index: 卡死{idx['maxit']} err{idx['error']} top`{idx['top_tool']}`", flush=True)
        entries = load_index()
        # 生成当日报告（含趋势）
        report = render_report(tags, entries)
        rpath = os.path.join(REPORT_DIR, f"{time.strftime('%Y-%m-%d')}.md")
        with open(rpath, "w", encoding="utf-8") as f:
            f.write(report)
        print(f"[report] → {rpath}", flush=True)
        print("\n" + report, flush=True)


if __name__ == "__main__":
    main()
