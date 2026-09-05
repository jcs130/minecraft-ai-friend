import io, sys, os, re, subprocess, urllib.parse, zipfile
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
TMP = r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\tmp"
OUT = os.path.join(TMP, "tlm_packs")
FF = r"C:\Users\lzl19\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin\ffmpeg.exe"
OPS = [("佩佩","ark_pepe"),("贝娜","ark_bena"),("桃金娘","ark_myrtle"),("澄闪","ark_golding"),("阿米娅","ark_amiya"),("德克萨斯","ark_texas")]

for cn, pid in OPS:
    url = "https://wiki.biligame.com/arknights/" + urllib.parse.quote(cn)
    h = subprocess.run(["curl", "-s", "-A", "Mozilla/5.0", url], capture_output=True).stdout.decode("utf-8", "ignore")
    # alt="{干员名}{数字}.png" 的立绘缩略图；thumb URL 去掉 thumb 段与文件名前缀换原图
    m = re.search(r'<img[^>]*alt="' + cn + r'\d+\.png"[^>]*src="(https://patchwiki\.biligame\.com/images/arknights/thumb/([0-9a-f]/[0-9a-f]{2})/([0-9a-z]+)\.png/)', h)
    if not m:
        print("NOART", cn); continue
    orig = f"https://patchwiki.biligame.com/images/arknights/{m.group(2)}/{m.group(3)}.png"
    raw = os.path.join(TMP, f"art_{pid}.png")
    subprocess.run(["curl", "-s", "-A", "Mozilla/5.0", "-o", raw, orig], capture_output=True)
    if not (os.path.exists(raw) and os.path.getsize(raw) > 5000):
        print("DLOWFAIL", cn); continue
    icon = os.path.join(OUT, pid, f"assets/{pid}/textures/sound_icon.png")
    # 立绘竖长图：取上部 45% 高度内裁正方形（含脸部），缩 64x64
    r = subprocess.run([FF, "-y", "-loglevel", "error", "-i", raw, "-vf",
        "crop='min(iw,ih*0.45)':'min(iw,ih*0.45)':(iw-ow/2)/2:0,scale=64:64",
        "-frames:v", "1", icon], capture_output=True)
    if r.returncode != 0:
        print("CROPFAIL", cn, r.stderr.decode(errors="ignore")[:100]); continue
    # 重 zip
    packdir = os.path.join(OUT, pid)
    zfn = os.path.join(OUT, f"{pid}-1.0.0.zip")
    with zipfile.ZipFile(zfn, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, fs in os.walk(packdir):
            for f in fs:
                p = os.path.join(root, f)
                z.write(p, os.path.relpath(p, packdir).replace(os.sep, "/"))
    print("ICON OK", cn, "->", pid, os.path.getsize(zfn)//1024, "KB")
print("done")
