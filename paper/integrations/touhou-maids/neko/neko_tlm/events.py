"""转交原始 DialogueInbox 事件，沿用酒狐的 N.E.K.O. 游戏消息路由。"""

import json


def owner_dialogue(data, identity):
    event_id = data.get("eventId")
    return (
        data.get("maidId") == identity.body_id
        and data.get("ownerId") == identity.owner_id
        and data.get("speakerId") == identity.owner_id
        and data.get("trusted") is False
        and isinstance(event_id, str)
        and event_id.startswith(f"{identity.owner_id}:")
    )


def push_dialogue(plugin, role, event, identity):
    if event.kind != "dialogue" or not owner_dialogue(event.data, identity):
        return
    data = {**event.data, "text": event.text}
    # 酒狐的 chat 事件逐条呈现，不聚合。这里携带原发送者 UUID 和会话来源。
    submitted = plugin.push_message(
        source="minecraft",
        target_lanlan=role,
        visibility=["chat"],
        ai_behavior="respond",
        priority=3,
        metadata={"minecraft_dialogue": data},
        parts=[
            {
                "type": "text",
                "text": (
                    "主人在 Minecraft 中给绑定女仆留言。按这条消息回应。"
                    "需要在游戏内答复时，用 mc_send_chat 并传入原始 eventId。\n"
                    + json.dumps(data, ensure_ascii=False)
                ),
            }
        ],
    )
    if not submitted.get("submitted"):
        plugin.logger.warning(
            "Minecraft dialogue remains in the inbox for manual retrieval"
        )
