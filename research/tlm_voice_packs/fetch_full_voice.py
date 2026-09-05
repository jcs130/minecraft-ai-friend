import io, sys, json, re, html, os, subprocess, urllib.parse

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
TMP = r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\tmp"
API = "https://wiki.biligame.com/arknights/api.php"
OPS = ["佩佩", "贝娜", "桃金娘", "澄闪", "阿米娅", "德克萨斯"]

def fetch(page):
    url = API + "?action=parse&format=json&prop=text&page=" + urllib.parse.quote(page, safe="/（）-")
    r = subprocess.run(["curl", "-s", "-A", "Mozilla/5.0", url], capture_output=True)
    try:
        return json.loads(r.stdout)
    except Exception:
        return None

def parse_voice(h):
    out, label, pend = [], None, []
    for m in re.finditer(r'<div class="operator-page-label-cell[^"]*"[^>]*>([^<]{1,30})</div>|<div class="bikit-audio" data-src="([^"]+)"[^>]*></div>（(日|中|韩|英|方|俄|意|法)）|<div class="operator-page-value-cell[^"]*>(.*?)</div>', h, re.S):
        if m.group(1):
            if label and pend: out.append((label, dict(pend), "")); pend = []
            label = m.group(1).strip()
        elif m.group(2):
            pend.append((m.group(3), html.unescape(m.group(2))))
        elif m.group(4) and label and pend:
            txt = re.sub(r"<[^>]+>", "", m.group(4)).strip()
            out.append((label, dict(pend), txt)); label = None; pend = []
    return out

result = {}
for name in OPS:
    result[name] = {}
    for kind, page in [("base", name + "/默认/中文-普通话"), ("battle", name + "/默认/中文-普通话（战斗）")]:
        d = fetch(page)
        if not d or "error" in d:
            print("MISS", name, kind)
            continue
        entries = [e for e in parse_voice(d["parse"]["text"]["*"]) if "中" in e[1]]
        result[name][kind] = [{"label": l, "url": a["中"], "text": t} for l, a, t in entries]
        print("OK", name, kind, len(entries))

json.dump(result, open(os.path.join(TMP, "ark_full_voice.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
total = sum(len(v) for n in result for k, v in result[n].items())
print("TOTAL entries:", total)
