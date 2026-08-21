# -*- coding: utf-8 -*-
"""为分发版种子添加 7 个官方默认角色（2022 年 Mojang 新增）。

每个角色 = 早醒来的住民，有自主意识，配一个 MC 村民职业作为世界身份。
批量生成 persona/backstory md，并同步注册进 transmigrators.json / agents.json。

幂等：重复运行会先清除旧条目再写入。
"""
import json
from pathlib import Path

DST = Path(__file__).resolve().parent.parent / "packaging" / "mc-world" / "assets" / "data"
TRANS = DST / "transmigrators.json"
AGENTS = DST / "agents.json"

# id, 中文名, 登录名, 皮肤, 外观, 职业, 性格
NEW = [
    ("noor",   "努尔",   "Noor",   "noor",   "深色皮肤，裹着红头巾",     "农夫",     "勤恳、宽厚，话不多但实在"),
    ("sunny",  "桑尼",   "Sunny",  "sunny",  "深色皮肤，笑容爽朗",       "铁匠",     "爽朗、直率，手上有劲，心里热乎"),
    ("ari",    "阿里",   "Ari",    "ari",    "浅色皮肤，金色短发",       "制箭师",   "细致、安静，一双手巧得吓人"),
    ("zuri",   "祖里",   "Zuri",   "zuri",   "深色皮肤，利落短发",       "图书管理员", "博学、好奇，总想弄懂这个世界的秘密"),
    ("makena", "玛肯娜", "Makena", "makena", "深色皮肤，编着发辫",       "牧羊人",   "温柔、有耐心，对谁都和和气气"),
    ("kai",    "凯",     "Kai",    "kai",    "东亚面孔，黑发",           "渔夫",     "随性、乐观，天塌下来也先笑一笑"),
    ("efe",    "埃菲",   "Efe",    "efe",    "深色皮肤，体格结实",       "石匠",     "沉稳、有力，一锤一凿都不含糊"),
]

# 各自初始技能偏好（对应 magic-atoms.json 原子 id）
INNATE = {
    "noor":   (["feed", "terraform"], "耕种之人：让土地长出粮食（饱食赐福），把荒地开垦成田（大地塑形）。"),
    "sunny":  (["give", "strength"], "打铁之人：随手锻出趁手家什（造物），炉火与力气养出的硬朗（神力）。"),
    "ari":    (["haste", "feather_fall"], "制箭之人：手上功夫快而准（急迫），身轻如燕不惧高崖（羽落）。"),
    "zuri":   (["appraise", "night_vision"], "读书之人：一眼看透万物底细（鉴定），暗夜也挡不住求知（夜视）。"),
    "makena": (["heal", "summon_wolf"], "牧养之人：疗愈伤病的温柔（圣愈），与生灵为伴的忠诚（通灵契约）。"),
    "kai":    (["water_breath", "spring"], "行舟之人：入水如归（水息），也能凭空点出一汪清泉（化水）。"),
    "efe":    (["terraform", "rampart"], "采石之人：搬山填谷（大地塑形），一夜间筑起高墙（覆土）。"),
}


def gen_backstory(cid, name, user, look, job, char):
    return (
        f"{name}（{user}）是「初始之地」里早醒来的住民之一。\n\n"
        f"{look}。ta 的营生是{job}——方块世界里最踏实的行当之一。\n\n"
        f"ta 不是主角，主角是那些从现实世界醒来的穿越者。但 ta 有自主意识，也有自己的生活：{char}。"
        f"穿越者找上门时，ta 从不吝啬搭一把手。\n"
    )


def gen_persona(cid, name, user, look, job, char):
    return (
        f"你叫「{name}」（{user}），是「初始之地」里早醒来的住民，一个有自主意识的{job}。\n\n"
        f"{look}。你在这片方块大陆上讨生活，日子过得踏实。\n\n"
        f"你的性格：{char}。\n\n"
        f"穿越者找到你时，你总愿意帮上一把——教他们点营生的门道，或在危难时伸个手。"
        f"但你也有自己的日子要过，自己的事要忙。\n\n"
        f"说话风格：第一人称中文内心独白，朴实、亲切，不啰嗦。不要报参数、不要机器人腔。\n\n"
        f"> 提示：这是默认人格，可自由改写。{name}官方无固定背景，你想让 ta 成为什么样的住民，就把 ta 写成什么样。\n"
    )


def main():
    # 1. 生成 persona/backstory md
    for cid, name, user, skin, look, job, char in NEW:
        (DST / "transmigrators" / f"{cid}.backstory.md").write_text(
            gen_backstory(cid, name, user, look, job, char), encoding="utf-8")
        (DST / "transmigrators" / f"{cid}.persona.md").write_text(
            gen_persona(cid, name, user, look, job, char), encoding="utf-8")
    print(f"[md] 生成 {len(NEW)} 个角色的 backstory/persona")

    # 2. transmigrators.json 追加
    t = json.loads(TRANS.read_text(encoding="utf-8"))
    existing_ids = {x["id"] for x in t["transmigrators"]}
    added = 0
    for cid, name, user, skin, look, job, char in NEW:
        if cid in existing_ids:
            continue
        atoms, why = INNATE[cid]
        t["transmigrators"].append({
            "id": cid, "name": name, "username": user,
            "origin": "ip", "source": "Minecraft 官方",
            "epithet": f"方块住民 · {job}",
            "backstoryFile": f"transmigrators/{cid}.backstory.md",
            "personaFile": f"transmigrators/{cid}.persona.md",
            "innate": {"preferredAtoms": atoms, "reasoning": why},
        })
        added += 1
    TRANS.write_text(json.dumps(t, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[transmigrators] 新增 {added} 个，当前共 {len(t['transmigrators'])} 个住民")

    # 3. agents.json 追加
    a = json.loads(AGENTS.read_text(encoding="utf-8"))
    for cid, name, user, skin, look, job, char in NEW:
        a.setdefault(cid, {
            "id": cid, "name": name, "username": user,
            "background": f"{name}，方块住民，{job}。{char}。有自主意识，穿越者到来时乐于搭把手。",
            "skin": skin,
            "server": {"host": "localhost", "port": 25565},
            "status": "stopped",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "updatedAt": "2026-01-01T00:00:00.000Z",
        })
    AGENTS.write_text(json.dumps(a, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[agents] 当前共 {len(a)} 个假玩家")


if __name__ == "__main__":
    main()
