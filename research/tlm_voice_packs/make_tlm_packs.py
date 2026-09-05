import io, sys, json, os, subprocess, re, urllib.parse, zipfile, html

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
TMP = r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\tmp"
FF = r"C:\Users\lzl19\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin\ffmpeg.exe"
DATA = json.load(open(os.path.join(TMP, "ark_full_voice.json"), encoding="utf-8"))
OUT = os.path.join(TMP, "tlm_packs"); os.makedirs(OUT, exist_ok=True)
REF = os.path.join(TMP, "tts_refs"); os.makedirs(REF, exist_ok=True)
UA = ["curl", "-s", "-A", "Mozilla/5.0"]

OPS = [
    ("佩佩", "ark_pepe", "小公主腔"),
    ("贝娜", "ark_bena", "人偶小姑娘"),
    ("桃金娘", "ark_myrtle", "元气小个头"),
    ("澄闪", "ark_golding", "软妹絮叨"),
    ("阿米娅", "ark_amiya", "萝莉·主音"),
    ("德克萨斯", "ark_texas", "冷淡少女"),
]

# (目录, 事件, 序号) ← 方舟台词 label。语义映射，一源可多用。
ASSIGN = [
    ("ai","tamed",1,"干员报到"),("ai","tamed",2,"任命助理"),("ai","tamed",3,"任命队长"),("ai","tamed",4,"信赖触摸"),("ai","tamed",5,"戳一下"),
    ("ai","find_target",1,"选中干员1"),("ai","find_target",2,"选中干员2"),("ai","find_target",3,"行动出发"),("ai","find_target",4,"行动开始"),("ai","find_target",5,"部署1"),("ai","find_target",6,"部署2"),
    ("ai","hurt",1,"作战中1"),("ai","hurt",2,"作战中2"),("ai","hurt",3,"作战中3"),("ai","hurt",4,"作战中4"),("ai","hurt",5,"行动失败"),("ai","hurt",6,"非3星结束行动"),("ai","hurt",7,"作战中1"),("ai","hurt",8,"作战中3"),("ai","hurt",9,"行动失败"),("ai","hurt",10,"非3星结束行动"),
    ("ai","hurt_fire",1,"作战中2"),("ai","hurt_fire",2,"作战中3"),("ai","hurt_fire",3,"作战中4"),
    ("ai","hurt_player",1,"信赖提升后交谈2"),("ai","hurt_player",2,"信赖提升后交谈3"),
    ("ai","item_get",1,"3星结束行动"),("ai","item_get",2,"完成高难行动"),("ai","item_get",3,"精英化晋升1"),("ai","item_get",4,"精英化晋升2"),("ai","item_get",5,"编入队伍"),("ai","item_get",6,"观看作战记录"),("ai","item_get",8,"精英化晋升1"),("ai","item_get",9,"精英化晋升2"),
    ("ai","death",1,"行动失败"),("ai","death",2,"非3星结束行动"),("ai","death",3,"作战中3"),
    ("ai","game_win",1,"3星结束行动"),("ai","game_win",2,"完成高难行动"),("ai","game_win",3,"精英化晋升1"),("ai","game_win",4,"精英化晋升2"),("ai","game_win",5,"干员报到"),
    ("ai","game_lost",1,"行动失败"),("ai","game_lost",2,"非3星结束行动"),("ai","game_lost",3,"作战中4"),("ai","game_lost",4,"行动失败"),("ai","game_lost",5,"非3星结束行动"),
    ("environment","morning",1,"问候"),("environment","morning",2,"新年祝福"),
    ("environment","night",1,"闲置"),("environment","night",2,"进驻设施"),
    ("environment","rain",1,"闲置"),
    ("environment","snow",1,"新年祝福"),("environment","snow",2,"生日"),
    ("environment","cold",1,"交谈2"),("environment","cold",2,"交谈3"),
    ("environment","hot",1,"交谈1"),("environment","hot",2,"交谈2"),
    ("mode","idle",1,"交谈1"),("mode","idle",2,"交谈2"),("mode","idle",3,"交谈3"),("mode","idle",4,"信赖提升后交谈1"),("mode","idle",5,"信赖提升后交谈2"),("mode","idle",6,"信赖提升后交谈3"),("mode","idle",8,"晋升后交谈1"),("mode","idle",9,"晋升后交谈2"),
    ("mode","attack",1,"行动开始"),("mode","attack",2,"作战中1"),("mode","attack",3,"作战中2"),("mode","attack",4,"作战中3"),("mode","attack",5,"作战中4"),("mode","attack",6,"选中干员1"),
    ("mode","range_attack",1,"部署1"),("mode","range_attack",2,"部署2"),("mode","range_attack",3,"选中干员2"),
    ("mode","danmaku_attack",1,"作战中1"),("mode","danmaku_attack",2,"作战中2"),("mode","danmaku_attack",3,"作战中3"),
    ("mode","feed",1,"信赖提升后交谈1"),("mode","feed",2,"交谈2"),("mode","feed",3,"交谈3"),("mode","feed",4,"晋升后交谈1"),("mode","feed",5,"晋升后交谈2"),("mode","feed",6,"问候"),
    ("mode","feed_animal",1,"交谈3"),("mode","feed_animal",2,"信赖提升后交谈1"),("mode","feed_animal",3,"信赖提升后交谈2"),("mode","feed_animal",4,"新年祝福"),("mode","feed_animal",5,"生日"),("mode","feed_animal",6,"问候"),("mode","feed_animal",7,"交谈1"),
    ("mode","farm",1,"交谈1"),("mode","farm",2,"交谈2"),("mode","farm",3,"交谈3"),("mode","farm",4,"晋升后交谈1"),("mode","farm",5,"晋升后交谈2"),("mode","farm",6,"信赖提升后交谈1"),("mode","farm",7,"信赖提升后交谈2"),("mode","farm",8,"信赖提升后交谈3"),("mode","farm",9,"闲置"),
    ("mode","furnace",1,"交谈1"),("mode","furnace",2,"交谈2"),("mode","furnace",3,"交谈3"),("mode","furnace",4,"晋升后交谈1"),("mode","furnace",5,"晋升后交谈2"),("mode","furnace",6,"信赖提升后交谈1"),("mode","furnace",7,"信赖提升后交谈2"),("mode","furnace",8,"信赖提升后交谈3"),
    ("mode","torch",1,"交谈1"),("mode","torch",2,"交谈2"),("mode","torch",3,"交谈3"),("mode","torch",4,"晋升后交谈1"),("mode","torch",5,"晋升后交谈2"),("mode","torch",6,"信赖提升后交谈1"),
    ("mode","shears",1,"交谈2"),("mode","shears",2,"交谈3"),
    ("mode","milk",1,"交谈1"),("mode","milk",2,"交谈2"),
    ("mode","snow",1,"新年祝福"),("mode","snow",2,"生日"),("mode","snow",3,"新年祝福"),("mode","snow",4,"生日"),
    ("mode","break",1,"作战中2"),
    ("mode","brewing",1,"交谈1"),("mode","brewing",2,"交谈2"),("mode","brewing",3,"交谈3"),("mode","brewing",4,"信赖提升后交谈1"),("mode","brewing",5,"信赖提升后交谈2"),("mode","brewing",6,"信赖提升后交谈3"),("mode","brewing",7,"晋升后交谈1"),("mode","brewing",8,"晋升后交谈2"),("mode","brewing",9,"问候"),("mode","brewing",10,"新年祝福"),("mode","brewing",11,"生日"),("mode","brewing",12,"闲置"),
    ("mode","extinguishing",1,"交谈1"),("mode","extinguishing",2,"交谈2"),("mode","extinguishing",3,"交谈3"),("mode","extinguishing",4,"信赖提升后交谈1"),("mode","extinguishing",5,"信赖提升后交谈2"),
    ("other","credit",1,"干员报到"),
]

def get_avatar(name):
    """抠干员页头像"""
    url = "https://wiki.biligame.com/arknights/" + urllib.parse.quote(name)
    r = subprocess.run(UA + [url], capture_output=True)
    h = r.stdout.decode("utf-8", errors="ignore")
    # 干员页头像一般是 patchwiki 上的小图
    m = re.search(r'<img[^>]+src="(https://patchwiki\.biligame\.com/images/arknights/[^"]+)"[^>]*>', h)
    if m:
        return m.group(1)
    return None

AVATARS = {}
for cn, pid, _ in OPS:
    AVATARS[cn] = get_avatar(cn)
    print("avatar", cn, AVATARS[cn] or "MISS")

for cn, pid, style in OPS:
    entries = DATA[cn]["base"]
    by_label = {}
    for e in entries:
        by_label.setdefault(e["label"], e)
    # 去重源缓存
    src_cache = {}
    def get_src(label):
        if label not in by_label: return None
        if label not in src_cache:
            fn = os.path.join(TMP, f"src_{pid}_{abs(hash(label))%99999}")
            subprocess.run(UA + ["-o", fn, by_label[label]["url"]], capture_output=True)
            src_cache[label] = fn if os.path.exists(fn) and os.path.getsize(fn) > 20000 else None
        return src_cache[label]
    packdir = os.path.join(OUT, pid)
    os.makedirs(packdir, exist_ok=True)
    ok, miss = 0, []
    for cat, ev, idx, label in ASSIGN:
        src = get_src(label)
        if not src:
            miss.append(f"{cat}/{ev}{idx}<-{label}")
            continue
        rel = f"assets/{pid}/sounds/maid/{cat}/{ev}{idx}.ogg"
        dst = os.path.join(packdir, rel.replace("/", os.sep))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        r = subprocess.run([FF, "-y", "-loglevel", "error", "-i", src, "-c:a", "libvorbis", "-ar", "22050", "-ac", "1", "-q:a", "4", dst], capture_output=True)
        ok += 1 if r.returncode == 0 else 0
    # TTS 参考：任命助理 → wav
    src = get_src("任命助理") or get_src("干员报到")
    if src:
        subprocess.run([FF, "-y", "-loglevel", "error", "-i", src, "-ar", "44100", "-ac", "1", os.path.join(REF, f"{cn}.wav")], capture_output=True)
    # 元文件
    os.makedirs(os.path.join(packdir, f"assets/{pid}/lang"), exist_ok=True)
    os.makedirs(os.path.join(packdir, f"assets/{pid}/textures"), exist_ok=True)
    open(os.path.join(packdir, "pack.mcmeta"), "w", encoding="utf-8").write('{"pack":{"pack_format":3,"description":"Touhou Little Maid Sound Pack"}}')
    ms = {"pack_name": "{sound_pack.%s.name}" % pid, "author": ["天神"], "description": "{sound_pack.%s.desc}" % pid,
          "url": "", "version": "1.0.0", "date": "2026-09-06", "icon": f"{pid}:textures/sound_icon.png"}
    open(os.path.join(packdir, f"assets/{pid}/maid_sound.json"), "w", encoding="utf-8").write(json.dumps(ms, ensure_ascii=False, indent="\t"))
    open(os.path.join(packdir, f"assets/{pid}/lang/zh_cn.lang"), "w", encoding="utf-8").write(
        f"sound_pack.{pid}.name={cn}声音包\nsound_pack.{pid}.desc=配音：明日方舟官方中文CV；{style}\n")
    open(os.path.join(packdir, f"assets/{pid}/lang/en_us.lang"), "w", encoding="utf-8").write(
        f"sound_pack.{pid}.name={cn} Voice\nsound_pack.{pid}.desc=Arknights official CN voice\n")
    # 图标
    icon = os.path.join(packdir, f"assets/{pid}/textures/sound_icon.png")
    if AVATARS[cn]:
        r = subprocess.run(UA + ["-o", icon, AVATARS[cn]], capture_output=True)
        if not (os.path.exists(icon) and os.path.getsize(icon) > 1000):
            subprocess.run([FF, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0xE8A0BF:s=64x64", "-frames:v", "1", icon], capture_output=True)
    else:
        subprocess.run([FF, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0xE8A0BF:s=64x64", "-frames:v", "1", icon], capture_output=True)
    # zip
    zfn = os.path.join(OUT, f"{pid}-1.0.0.zip")
    with zipfile.ZipFile(zfn, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, fs in os.walk(packdir):
            for f in fs:
                p = os.path.join(root, f)
                z.write(p, os.path.relpath(p, packdir).replace(os.sep, "/"))
    print("PACK", cn, pid, "ogg:", ok, "miss:", len(miss), miss[:3], "zip KB:", os.path.getsize(zfn)//1024)
print("done")
