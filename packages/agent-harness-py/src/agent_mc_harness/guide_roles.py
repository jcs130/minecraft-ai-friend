"""Player guides enter the same NPC host through the authenticated native maid roster."""
from base64 import b32encode
from uuid import NAMESPACE_URL, UUID, uuid5

from .npc import NpcRole


GUIDE_TOOLS = [
    "body:observe", "body:inventory", "body:chat", "body:follow", "body:stay",
    "body:move", "body:equip", "body:cast", "body:craft", "body:pickup",
    "body:native:spells", "body:native:tasks", "body:native:task", "body:native:guard",
    "body:native:fish", "body:native:dismount", "body:native:workshop",
]
GUIDE_PERSONA = (
    "你是这位玩家的冒险伙伴。用简短自然的中文交谈。"
    "有人明确叫你或玩家遇到眼前障碍时再说话；避免重复招呼、打断别人或播报私有数据。"
    "用 ownerOnboarding 和眼前的真实状态给一个可执行的下一步，说明从罗盘、路牌或实体按钮怎么操作。"
    "玩家自己选择报名、接单、交付和进副本。你可以跟随、护卫、用自己的物品和已学技能施法，或协助实际制作。"
    "缺装备、权限、材料或接收回执时据实说明；身体动作失败就查看原结果。没有需要时安静陪伴。"
)


def parse_guide_roster(payload, server_id, settings):
    if payload.get("protocol") != "qiandengji-maid-body/v1" or not isinstance(payload.get("guides"), list):
        raise ValueError("guide_roster_invalid")
    guides = {}
    bodies = set()
    for row in payload["guides"]:
        owner, body = UUID(row["ownerId"]), UUID(row["maidId"])
        role_id = "guide_" + b32encode(owner.bytes).decode("ascii").rstrip("=").lower()
        if row["confirmed"] is not True or role_id in guides or body in bodies or body == owner:
            raise ValueError("guide_roster_identity_conflict")
        role = NpcRole(
            id=role_id, name=row["name"], character_id=uuid5(NAMESPACE_URL, f"{server_id}/guide/{owner}"),
            owner_id=owner, body_id=body, body_kind="maid", persona=GUIDE_PERSONA,
            model=settings["model"], provider=settings.get("provider", "tokenplan"),
            interval_seconds=settings.get("intervalSeconds", 90), default_native_guard=True,
            max_speech_chars=42, allowed_tools=GUIDE_TOOLS,
        )
        guides[role_id] = role
        bodies.add(body)
    return guides
