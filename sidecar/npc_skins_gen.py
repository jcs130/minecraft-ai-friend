# -*- coding: utf-8 -*-
"""
npc_skins_gen.py — 初始之地站桩 NPC 原创皮肤生成器（纯 vanilla 管线的一环）
产出：
  data/skins/<key>.png                64x64 标准皮肤（头颅贴图客户端拉取的就是它）
  data/village/skin-registry.json     盔甲架 NBT 素材（b64/染色皮革甲/姿势/持物）
  data/skins/preview_all.png          设计稿预览（放大拼图，人审用）
设计原则：头颅只渲染头部 8x8（脸）+ 帽层 8x8，所以脸是灵魂；
身体色板同时用于预览与游戏内染色皮革甲（三件套同色系渐变）。
"""
import base64, io, json, os, random, sys
from PIL import Image, ImageDraw, ImageFont

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SKIN_DIR = os.path.join(REPO, "data", "skins")
REG_PATH = os.path.join(REPO, "data", "village", "skin-registry.json")
PANEL_URL = "http://192.168.3.133:9090/skins/%s.png"
os.makedirs(SKIN_DIR, exist_ok=True)

# ---------------- 调色板与角色设定 ----------------
SKINS = {
    "yueshan": {
        "display": "铁匠·岳山", "name_en": "NPC_Yueshan",
        "skin": (184, 122, 80), "skin_shade": (160, 100, 64),
        "hair": (35, 28, 24), "brow": (30, 24, 20), "eye": (59, 43, 32),
        "band": (140, 59, 59),
        "beard": (30, 24, 20), "beard_rows": (5, 7),  # hat 层大胡
        "robe": (122, 46, 46), "robe2": (96, 34, 34), "belt": (58, 44, 36),
        "boots_rgb": 0x4A3826, "legs_rgb": 0x602222, "chest_rgb": 0x7A2E2E,
        "pose": {"RightArm": [-72, 0, -18], "LeftArm": [26, 0, 22]},
        "mainhand": "minecraft:iron_sword",
    },
    "shilei": {
        "display": "甲匠·石磊", "name_en": "NPC_Shilei",
        "skin": (196, 164, 148), "skin_shade": (172, 140, 124),
        "hair": (154, 160, 166), "brow": (96, 102, 108), "eye": (88, 74, 58),
        "smudge": (150, 132, 118),
        "beard": None,
        "robe": (90, 100, 112), "robe2": (72, 80, 92), "belt": (52, 46, 40),
        "boots_rgb": 0x3A4048, "legs_rgb": 0x48505A, "chest_rgb": 0x5A6470,
        "pose": {"RightArm": [6, 0, 4], "LeftArm": [4, 0, -4]},
        "mainhand": "minecraft:anvil",
    },
    "mobai": {
        "display": "书商·墨白", "name_en": "NPC_Mobai",
        "skin": (232, 200, 168), "skin_shade": (208, 174, 142),
        "hair": (224, 222, 214), "brow": (216, 214, 206), "eye": (44, 40, 38),
        "sidehair": True, "mustache": (226, 224, 216),
        "beard": None,
        "robe": (232, 232, 226), "robe2": (196, 204, 210), "belt": (108, 124, 132),
        "boots_rgb": 0x6C7C84, "legs_rgb": 0xC4CCD2, "chest_rgb": 0xE8E8E2,
        "pose": {"RightArm": [-34, 0, 26], "LeftArm": [-34, 0, -26]},
        "mainhand": "minecraft:book",
    },
    "yunji": {
        "display": "书商·云笈", "name_en": "NPC_Yunji",
        "skin": (216, 168, 120), "skin_shade": (192, 144, 98),
        "hair": (28, 26, 30), "brow": (24, 22, 26), "eye": (40, 32, 28),
        "band": (62, 142, 94), "sideburns": (28, 26, 30),
        "beard": None,
        "robe": (46, 107, 79), "robe2": (34, 86, 62), "belt": (150, 120, 70),
        "boots_rgb": 0x4E3E28, "legs_rgb": 0x2E5642, "chest_rgb": 0x2E6B4F,
        "pose": {"RightArm": [-30, 0, 18], "LeftArm": [-8, 0, -6]},
        "mainhand": "minecraft:writable_book",
    },
    "fubo": {
        "display": "货郎·福伯", "name_en": "NPC_Fubo",
        "skin": (176, 136, 96), "skin_shade": (152, 114, 78),
        "hair": (226, 222, 214), "brow": (220, 216, 208), "eye": (72, 54, 40),
        "beard": (226, 222, 214), "beard_rows": (4, 7),
        "wrinkle": True,
        "robe": (201, 162, 39), "robe2": (176, 138, 30), "belt": (110, 70, 36),
        "boots_rgb": 0x5A3E22, "legs_rgb": 0xB08A26, "chest_rgb": 0xC9A227,
        "pose": {"RightArm": [-118, 0, 14], "LeftArm": [10, 0, 30]},
        "mainhand": "minecraft:lead",
    },
}

# ---------------- 皮肤绘制 ----------------
def px(d, x, y, c):
    d.point((x, y), fill=c + (255,))

def hline(d, x0, x1, y, c):
    for x in range(x0, x1 + 1):
        px(d, x, y, c)

def draw_face(d, s):
    """脸 8x8 @(8,8)。y0 常被帽层刘海盖住，仍画底色。"""
    ox, oy = 8, 8
    skin, shade = s["skin"], s["skin_shade"]
    for yy in range(8):
        for xx in range(8):
            px(d, ox + xx, oy + yy, skin)
    # 发际/底色顶行
    hline(d, ox, ox + 7, oy, s["hair"])
    px(d, ox, oy + 1, s["hair"]); px(d, ox + 7, oy + 1, s["hair"])
    # 眉（y2）
    hline(d, ox + 1, ox + 2, oy + 2, s["brow"]); hline(d, ox + 5, ox + 6, oy + 2, s["brow"])
    # 眼（y4）：白 瞳 _ _ 瞳 白 —— 瞳孔近黑保证 8x8 下可读
    pupil = (24, 18, 14)
    px(d, ox + 1, oy + 4, (252, 252, 252)); px(d, ox + 2, oy + 4, pupil)
    px(d, ox + 5, oy + 4, pupil); px(d, ox + 6, oy + 4, (252, 252, 252))
    # 鼻（y5 中两格阴影）
    px(d, ox + 3, oy + 5, shade); px(d, ox + 4, oy + 5, shade)
    # 嘴（y6）——有帽层大胡时会被盖住，无胡者画嘴
    if not s.get("beard"):
        px(d, ox + 3, oy + 6, (150, 96, 84) if not s.get("wrinkle") else s["skin_shade"])
        px(d, ox + 4, oy + 6, (150, 96, 84) if not s.get("wrinkle") else s["skin_shade"])
    # 皱纹（福伯）
    if s.get("wrinkle"):
        px(d, ox + 3, oy + 3, shade); px(d, ox + 4, oy + 3, shade)
    # 灰尘（石磊右颊）
    if s.get("smudge"):
        px(d, ox + 1, oy + 5, s["smudge"]); px(d, ox + 2, oy + 6, s["smudge"])

def draw_hat(d, s):
    """帽层 8x8 @(40,8)：刘海/头带/侧发/胡须。透明处不画。"""
    ox, oy = 40, 8
    # 刘海（y0 全行）
    hline(d, ox, ox + 7, oy, s["hair"])
    # 头带（y1 整行，醒目）
    if s.get("band"):
        hline(d, ox, ox + 7, oy + 1, s["band"])
    else:
        hline(d, ox, ox + 1, oy + 1, s["hair"]); hline(d, ox + 6, ox + 7, oy + 1, s["hair"])
    # 白发侧发（墨白）
    if s.get("sidehair"):
        for yy in (2, 3, 4, 5):
            px(d, ox, oy + yy, s["hair"]); px(d, ox + 7, oy + yy, s["hair"])
        hline(d, ox, ox + 7, oy + 2, s["hair"])
    # 鬓角（云笈）
    if s.get("sideburns"):
        px(d, ox, oy + 2, s["sideburns"]); px(d, ox + 7, oy + 2, s["sideburns"])
        px(d, ox, oy + 3, s["sideburns"]); px(d, ox + 7, oy + 3, s["sideburns"])
    # 大胡子（岳山/福伯）：帽层下半盖脸 + 下缘外扩一圈
    if s.get("beard"):
        y0, y1 = s["beard_rows"]
        for yy in range(y0, y1 + 1):
            for xx in range(8):
                px(d, ox + xx, oy + yy, s["beard"])
        # 胡子下缘挂到下巴下（用帽层行的 8-15 无处可挂，省略；嘴上须：
        if y0 == 5:
            hline(d, ox + 2, ox + 5, oy + y0, s["beard"])
    # 八字须（墨白）
    if s.get("mustache"):
        px(d, ox + 2, oy + 5, s["mustache"]); px(d, ox + 5, oy + 5, s["mustache"])
        px(d, ox + 2, oy + 6, s["mustache"]); px(d, ox + 5, oy + 6, s["mustache"])

def draw_hat_sides_top(img, s):
    """帽层其余面：顶(40,0)全发色；右(32,8)/左(48,8)/背(56,8) 上半发色（或头带行）。"""
    d = ImageDraw.Draw(img)
    # 顶
    for yy in range(8):
        for xx in range(40, 48):
            px(d, xx, yy, s["hair"])
    for side_x in (32, 48, 56):
        hline(d, side_x, side_x + 7, 8, s["hair"])
        if s.get("band"):
            hline(d, side_x, side_x + 7, 9, s["band"])
        hline(d, side_x, side_x + 7, 10, s["hair"])
        if s.get("sidehair"):
            for yy in (11, 12, 13):
                px(d, side_x, yy, s["hair"]); px(d, side_x + 7, yy, s["hair"])
    # 修 draw_hat 里那行写歪的头带（32..39 行固定 y=8+1? 上面已补正确版，这里覆盖保证）：
    if s.get("band"):
        hline(d, 32, 39, 9, s["band"])

def draw_head_base(img, s):
    """头基色六面：前(8,8) 右(0,8) 左(16,8) 背(24,8) 顶(8,0) 底(16,0)。"""
    d = ImageDraw.Draw(img)
    def fill(x0, y0, c):
        for yy in range(8):
            for xx in range(8):
                px(d, x0 + xx, y0 + yy, c)
    fill(0, 8, s["hair"]); fill(16, 8, s["hair"]); fill(24, 8, s["hair"])
    fill(8, 0, s["hair"]); fill(16, 0, s["skin_shade"])

def draw_body(img, s):
    """身体/四肢正面 + 侧面基色。袍：领口对比色 + 腰带。"""
    d = ImageDraw.Draw(img)
    def rect(x0, y0, w, h, c):
        for yy in range(h):
            for xx in range(w):
                px(d, x0 + xx, y0 + yy, c)
    robe, robe2, belt = s["robe"], s["robe2"], s["belt"]
    # 身体正面 (20,20,8,12)：上下袍色，腰带上 1 行
    rect(20, 20, 8, 4, robe)          # 胸
    rect(20, 24, 8, 1, belt)          # 腰带
    rect(20, 25, 8, 7, robe2)         # 下摆
    rect(23, 20, 2, 2, robe2)         # 领口
    # 侧面近似
    rect(16, 20, 4, 12, robe2); rect(28, 20, 4, 12, robe2); rect(32, 20, 8, 12, robe2)
    # 腿正面 (4,20) 右 (20,52) 左 —— 袍长遮腿，用下摆色
    rect(4, 20, 4, 12, robe2); rect(0, 20, 4, 12, robe2); rect(8, 20, 4, 12, robe2)
    rect(20, 52, 4, 12, robe2); rect(16, 52, 4, 12, robe2); rect(24, 52, 4, 12, robe2)
    # 手臂正面 (44,20) 右 (52,52)? 左臂正面是 (36,52)
    rect(44, 20, 4, 12, robe); rect(40, 20, 4, 12, robe2); rect(48, 20, 4, 12, robe2)
    rect(36, 52, 4, 12, robe); rect(32, 52, 4, 12, robe2); rect(40, 52, 4, 12, robe2)
    # 手（袖口下端肤色，正面最后 2 行）
    rect(44, 30, 4, 2, s["skin"]); rect(36, 62, 4, 2, s["skin"])

def make_skin(s):
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw_head_base(img, s)
    d = ImageDraw.Draw(img)
    draw_face(d, s)
    draw_hat(d, s)
    draw_hat_sides_top(img, s)
    draw_body(img, s)
    return img

# ---------------- 预览拼图 ----------------
def front_view(img):
    """从皮肤取正面拼 12x24 人像：头8x8 帽层叠加 + 臂4x12x2 + 体8x12 + 腿4x12x2。"""
    head = img.crop((8, 8, 16, 16))
    hat = img.crop((40, 8, 48, 16))
    body = img.crop((20, 20, 28, 32))
    rarm = img.crop((44, 20, 48, 32))
    larm = img.crop((36, 52, 40, 64))
    rleg = img.crop((4, 20, 8, 32))
    lleg = img.crop((20, 52, 24, 64))
    view = Image.new("RGBA", (16, 32), (60, 66, 74, 255))
    view.alpha_composite(head, (4, 0))
    view.alpha_composite(hat, (4, 0))
    view.alpha_composite(body, (4, 8))
    view.alpha_composite(rarm, (0, 8))
    view.alpha_composite(larm, (12, 8))
    view.alpha_composite(rleg, (4, 20))
    view.alpha_composite(lleg, (8, 20))
    return view

def make_preview(images):
    SCALE = 8
    W = len(images) * (16 * SCALE + 24) + 24
    H = 32 * SCALE + 64
    sheet = Image.new("RGBA", (W, H), (34, 38, 46, 255))
    try:
        font = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 20)
    except Exception:
        font = ImageFont.load_default()
    dd = ImageDraw.Draw(sheet)
    x = 24
    for key, s in SKINS.items():
        view = front_view(images[key]).resize((16 * SCALE, 32 * SCALE), Image.NEAREST)
        sheet.alpha_composite(view, (x, 40))
        dd.text((x + 16 * SCALE // 2, 12), s["display"], font=font, fill=(235, 235, 235, 255), anchor="ma")
        dd.text((x + 16 * SCALE // 2, H - 30), key, font=font, fill=(150, 160, 170, 255), anchor="ma")
        x += 16 * SCALE + 24
    return sheet

# ---------------- 主流程 ----------------
def main():
    random.seed(20260817)
    registry = {}
    images = {}
    for key, s in SKINS.items():
        img = make_skin(s)
        path = os.path.join(SKIN_DIR, key + ".png")
        img.save(path)
        images[key] = img
        url = PANEL_URL % key
        payload = json.dumps({"textures": {"SKIN": {"url": url}}}, separators=(",", ":"))
        b64 = base64.b64encode(payload.encode()).decode()
        uid = [random.randint(-2 ** 31, 2 ** 31 - 1) for _ in range(4)]
        registry[key] = {
            "display": s["display"], "name_en": s["name_en"], "url": url,
            "b64": b64, "uuid_ints": uid,
            "robe": {"boots": s["boots_rgb"], "legs": s["legs_rgb"], "chest": s["chest_rgb"]},
            "pose": s["pose"], "mainhand": s["mainhand"],
        }
        print("skin:", key, "->", path)
    with open(REG_PATH, "w", encoding="utf-8") as f:
        json.dump(registry, f, ensure_ascii=False, indent=1)
    print("registry ->", REG_PATH)
    pv = make_preview(images)
    pv_path = os.path.join(SKIN_DIR, "preview_all.png")
    pv.save(pv_path)
    print("preview ->", pv_path)

if __name__ == "__main__":
    main()
