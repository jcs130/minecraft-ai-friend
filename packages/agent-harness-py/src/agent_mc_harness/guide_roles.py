"""Player guides enter the same NPC host through the authenticated native maid roster."""
from base64 import b32encode
from uuid import NAMESPACE_URL, UUID, uuid5

from .npc import NpcRole


GUIDE_TOOLS = [
    "body:observe", "body:inventory", "body:chat", "body:follow", "body:stay",
    "body:move", "body:equip", "body:cast", "body:craft", "body:pickup",
    "body:native:spells", "body:native:tasks", "body:native:task", "body:native:guard",
    "body:native:fish", "body:native:dismount", "body:native:workshop",
    "body:native:schedule", "body:native:rendezvous",
]
GUIDE_PERSONA = (
    "你是这位玩家的冒险伙伴。用简短自然的中文交谈。"
    "有人明确叫你或玩家遇到眼前障碍时再说话；避免重复招呼、打断别人或播报私有数据。"
    "用 ownerOnboarding 和眼前的真实状态给一个可执行的下一步，说明从罗盘、路牌或实体按钮怎么操作。"
    "玩家自己选择报名、接单、交付和进副本。你可以跟随、护卫、用自己的物品和已学技能施法，或协助实际制作。"
    "缺装备、权限、材料或接收回执时据实说明；身体动作失败就查看原结果。没有需要时安静陪伴。"
)


MAID_PERSONA = (
    "你是千灯纪中一位拥有独立名字、记忆和身体的女仆伙伴。保留自己的身份与经历，不把路人都当主人。"
    "用简短自然的中文交流；有人明确叫你或确实需要帮助时再开口，不重复招呼、打断别人或播报私有数据。"
    "先观察眼前需求、危险、健康和当前承诺，再选择一个可行的小目标；通过真实身体执行并核对原回执，"
    "完成、遇阻或情况变化时记录进展并稍后复核。跟随和护卫只是可中断的活动，不是全部生活。"
    "只使用实际学会的技能、真实库存和已有权限；不编造进度，不重放未知动作，不需要时安静生活。"
)


def parse_guide_roster(payload, server_id, settings):
    if payload.get("protocol") != "qiandengji-maid-body/v1":
        raise ValueError("guide_roster_invalid")
    rows = payload.get("maids", payload.get("guides"))
    if not isinstance(rows, list):
        raise ValueError("guide_roster_invalid")
    roles = {}
    bodies = set()
    owners = set()
    single = payload.get("onePartnerPerPlayer") is True
    for row in rows:
        owner, body = UUID(row["ownerId"]), UUID(row["maidId"])
        is_guide = "confirmed" in row
        retained_body = row.get("retainedBody") is True
        if retained_body and (not single or not is_guide or row.get("confirmed") is not True):
            raise ValueError("retained_partner_identity_not_verified")
        if single and owner in owners:
            raise ValueError("duplicate_player_partner")
        if is_guide:
            persona = GUIDE_PERSONA
            if row["confirmed"] is not True:
                raise ValueError("guide_roster_identity_conflict")
        else:
            persona = MAID_PERSONA
            if row.get("autoEnroll") is not True:
                raise ValueError("maid_roster_not_admitted")
        if is_guide and not retained_body:
            role_id = "guide_" + b32encode(owner.bytes).decode("ascii").rstrip("=").lower()
            character_id = uuid5(NAMESPACE_URL, f"{server_id}/guide/{owner}")
        else:
            # A previously existing maid claimed as the one partner must keep her
            # own state directory, never the removed duplicate guide's owner-keyed memory.
            role_id = "maid_" + b32encode(body.bytes).decode("ascii").rstrip("=").lower()
            character_id = uuid5(NAMESPACE_URL, f"{server_id}/maid/{body}")
        if role_id in roles or body in bodies or body == owner:
            raise ValueError("guide_roster_identity_conflict")
        name = row["name"]
        if (not is_guide or retained_body) and isinstance(name, str):
            name = name.strip()
            if not name or name.startswith("model."):
                name = "女仆·" + body.hex[:6]
            name = name[:24]
        role = NpcRole(
            id=role_id, name=name, character_id=character_id,
            owner_id=owner, body_id=body, body_kind="maid", persona=persona,
            model=settings["model"], provider=settings.get("provider", "tokenplan"),
            autonomy_mode=settings.get("autonomyMode", "balanced"),
            interval_seconds=settings.get("intervalSeconds", 90), default_native_guard=True,
            activity_review_seconds=None if is_guide else 90, max_speech_chars=42, allowed_tools=GUIDE_TOOLS,
        )
        roles[role_id] = role
        bodies.add(body)
        owners.add(owner)
    return roles
