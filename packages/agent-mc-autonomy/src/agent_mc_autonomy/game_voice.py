"""Recognize native nearby conversation and allowlist its local status."""

import re
from datetime import datetime

UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)
SEND_STATES = frozenset({
    "accepted", "synthesizing", "uploading", "queued", "playing", "sent", "failed", "cancelled", "unknown", "not_found",
})


def hearing_identity(event):
    meta = event.get("meta") or {}
    if ((event.get("source"), event.get("type"), meta.get("source"), meta.get("channel")) != (
            "minecraft", "minecraft.chat", "mcagent:voice/nearby_voice", "nearby-voice")
            or meta.get("transcript") is not True):
        return None
    speaker, utterance = meta.get("senderUuid"), meta.get("utteranceId")
    if all(isinstance(value, str) and UUID.fullmatch(value) for value in (speaker, utterance)):
        return speaker.lower(), utterance.lower()
    return None


def status_update(event):
    stamp = event.get("ts")
    if not isinstance(stamp, str) or len(stamp) > 40:
        return {}
    try:
        if datetime.fromisoformat(stamp).utcoffset() is None:
            return {}
    except ValueError:
        return {}
    if hearing_identity(event):
        return {"received_at": stamp}
    if (event.get("source"), event.get("type")) != ("minecraft", "minecraft.voice"):
        return {}
    receipt = (event.get("meta") or {}).get("proximityVoice")
    if not isinstance(receipt, dict) or receipt.get("recipientHeard") != "unknown":
        return {}
    game = receipt.get("game")
    state = game.get("state") if isinstance(game, dict) else None
    if not isinstance(state, str) or state not in SEND_STATES:
        return {}
    update = {"send_state": state, "send_at": stamp}
    delivery = game.get("delivery")
    count = delivery.get("listenerCount") if isinstance(delivery, dict) else None
    if state == "sent" and type(count) is int and 0 <= count <= 128:
        update["listener_count"] = count
    return update
