# -*- coding: utf-8 -*-
"""Existing Qiandeng guild rules and text, without runtime I/O.

Callers provide the current board, quest rows and configuration. This module
does not read files, contact Minecraft, award items or change quest state.
"""

RANKS = [("青铜", 0), ("黑铁", 10), ("白银", 30), ("黄金", 70), ("白金", 150), ("钻石", 350)]
BOARD_PAUSED_MARK = "暂停接取"
BOARD_FOOTER = "——接单：接 编号｜组队：组队接 编号 邀请 队友（被邀者回「入队」）｜交付：对岚说 交付 编号｜放弃：放弃 编号"


def rank_of(fame, ranks=RANKS):
    name = ranks[0][0]
    for nm, th in ranks:
        if fame >= th:
            name = nm
    return name


def rank_idx_of(fame, ranks=RANKS):
    idx = 0
    for i, (nm, th) in enumerate(ranks):
        if fame >= th:
            idx = i
    return idx


def zh_num(s):
    return int(s.translate(str.maketrans("０１２３４５６７８９", "0123456789")))


def takers(b):
    t = b.get("taker")
    if isinstance(t, str):
        return [t] if t else []
    return t or []


def rank_gate(b, fame, ranks=RANKS):
    """Return the original rank refusal, or None when the rank permits it."""
    need = b.get("rank", 0)
    if need <= 0:
        return None
    idx = rank_idx_of(fame, ranks)
    if idx >= need:
        return None
    return ("（把名册翻得哗啦响）No.%d 是%s级委托（要功勋%d），你眼下是%s、功勋%d——差着档呢，再喊几遍也接不上。"
            "先挑看板上没标档位的单子做（说「接 编号」），攒够功勋升%s再来。说「我的」看你手头在办的单子。"
            % (b["no"], ranks[need][0], ranks[need][1], ranks[idx][0], fame, ranks[need][0]))


def gather_matches(b, quests):
    """A reused daily quest ID alone does not establish matching goods."""
    q = next((q for q in quests if q.get("id") == b.get("qid")), None)
    return bool(q and q.get("villager") == b.get("from") and q.get("item") == b.get("item")
                and q.get("count") == b.get("count") and q.get("emerald") == b.get("reward"))


def is_far_horizon(b):
    # Only the exact legacy distance quest may omit its original spot field.
    return b.get("spot") == "far_horizon" or (not b.get("spot") and b.get("r") == 0
        and b.get("zh") == "远方的地平线" and b.get("title") == "朝圣·远方的地平线")


def new_claim_block(b, gather_valid, autogenerate):
    if b["type"] == "gather" and not gather_valid:
        return "这笔旧收购单与今日柜台货单不一致，暂不能接；请按当前村民柜台交货，或选普通讨伐和远行委托。"
    if not autogenerate:
        if b["type"] == "boss":
            return "这单需要召唤新的首领，本服暂未开放；已有记录保留，请先选普通讨伐或远行委托。"
        if b["type"] == "visit" and not is_far_horizon(b):
            return "这处旧地点尚未在本世界核验，暂不能接；请选远方地平线或普通讨伐委托。"
    return None


def board_header(day):
    return "【今日看板 · %s】" % day


def board_mark(b, ranks=RANKS):
    if b["status"] == "done":
        return "✔%s" % (b.get("done_by") or "")
    if b["status"] == "claimed":
        return "→%s" % "+".join(takers(b))
    return "可接" if b.get("rank", 0) <= 0 else "可接·需%s档" % ranks[b.get("rank", 0)][0]


def board_row(b, mark, ranks=RANKS):
    rank = "[%s]" % ranks[b.get("rank", 0)][0] if b.get("rank", 0) > 0 else ""
    party = "·组队%d人" % b["party"] if b.get("party") else ""
    return "No.%d %s%s%s（%s · 酬%d绿/功勋%d）[%s]" % (
        b["no"], rank, b["title"], party, b["display"], b["reward"], b.get("fame", 1), mark)


def my_lines(who, board):
    mine = [b for b in board if b["status"] == "claimed" and who in takers(b)]
    if not mine:
        return ["你眼下没有在办的委托。看板就在墙上——说「看板」瞅瞅去。"]
    out = ["你手头的委托："]
    for b in mine:
        mate = [t for t in takers(b) if t != who]
        mate_txt = "（与%s组队）" % "、".join(mate) if mate else ""
        if b["type"] == "gather":
            tip = "把 %d 个%s交到 %s 手上（对他说：交易：%s 给%d%s）" % (
                b["count"], b["zh"], b["display"], b["display"].split("·")[-1], b["count"], b["zh"])
        elif b["type"] == "lair":
            tip = "去广场%s%s外的哥布林营地%s，从赃物箱夺 %d 枚%s，回来对我说「交付 %d」" % (
                b["dir"], b["dist"], mate_txt, b["count"], b["zh"], b["no"])
        elif b["type"] == "treasure":
            tip = "宝箱埋在广场%s%s外的土下，挖出钻石信物，回来对我说「交付 %d」" % (
                b["dir"], b["dist"], b["no"])
        elif b["type"] == "boss":
            tip = "组队讨伐暴怒的劫掠兽%s——它盘踞在广场一带的荒野，队内任一人击杀即算达成" % mate_txt
        elif b["type"] == "hunt":
            tip = "去讨伐 %d 只%s（杀够自动结算）%s" % (b["count"], b["zh"], mate_txt)
        else:
            tip = "去一趟「%s」（走到即结算）" % b["zh"]
        out.append("No.%d %s——%s" % (b["no"], b["title"], tip))
    return out


def fame_lines(who, rec, ranks=RANKS):
    if not rec:
        return ["（翻了翻名册）还没有你的名字。说「注册」入会，或者直接接一单活儿——办成一单你就是青铜冒险者。"]
    cur = rank_of(rec["fame"], ranks)
    nxt = next(((nm, th) for nm, th in ranks if th > rec["fame"]), None)
    return ["%s：功勋 %d，等级「%s」，已完成 %d 单（%s入会）。%s" % (
        who, rec["fame"], cur, rec["done"], rec.get("joined", "?"),
        ("再攒 %d 功勋升%s。" % (nxt[1] - rec["fame"], nxt[0])) if nxt else "已是巅峰。")]
