"""Translate the N.E.K.O. tool surface to the existing MaidBody contract."""

import asyncio
import hashlib
import math
import re
import uuid

from agent_mc_harness.body.maid import MaidBody
from agent_mc_harness.models import ActionReceipt, BodyAction


def receipt_view(receipt: ActionReceipt) -> dict:
    reply = receipt.data or {}
    native = reply.get("reply", reply).get("data") or {}
    observation = native.get("observation") or {}
    result = {
        "request_id": receipt.request_id,
        "status": receipt.status,
        "terminal": receipt.terminal,
        "retryAllowed": False,
        "message": receipt.text,
    }
    for key in (
        "action",
        "goalCompleted",
        "actualPosition",
        "reason",
        "observedAt",
        "namespace",
    ):
        if key in native:
            result[key] = native[key]
    if "status" in native:
        result["nativeStatus"] = native["status"]
    for key in (
        "reason",
        "effectsApplied",
        "distanceMoved",
        "remainingDistance",
        "deliveredPlayers",
        "hearingVerified",
    ):
        if key in observation:
            result[key] = observation[key]
    return result


def tool_error(code: str, **details) -> dict:
    return {"output": {"error": code, **details}, "is_error": True, "error": code}


class BodyTools:
    def __init__(self, body: MaidBody):
        self.body = body
        self.available: list[str] = []

    async def _action(self, name, *, request_id=None, **args):
        return await self.body.act(
            BodyAction(
                verb="native",
                name=name,
                args=args,
                request_id=request_id or f"neko_{uuid.uuid4().hex}",
            )
        )

    async def _read(self, name):
        receipt = await self._action(name)
        if receipt.status != "completed":
            return None
        return receipt.data["reply"]["data"]

    async def status(self):
        snapshot = await self.body.snapshot()
        identity = self.body.identity()
        state = snapshot.raw or {}
        return {
            "maidId": identity.body_id,
            "ownerId": identity.owner_id,
            "name": state.get("name", identity.name),
            "lifeState": snapshot.life_state,
            "position": snapshot.position,
            "dimension": snapshot.dimension,
            "health": snapshot.health,
            "maxHealth": snapshot.max_health,
            "sampledAt": state.get("sampledAt"),
            "sitting": state.get("sitting"),
            "homeMode": state.get("homeMode"),
            "taskId": state.get("taskId"),
            "physicalController": state.get("physicalController"),
            "tools": self.available,
        }

    async def follow(self, *, action):
        if action not in ("follow", "stay"):
            return tool_error("FOLLOW_OR_STAY_REQUIRED")
        return receipt_view(await self._action(action))

    async def walk(self, *, x, y, z, dimension):
        if not isinstance(dimension, str) or not re.fullmatch(
            r"[a-z0-9_.-]+:[a-z0-9_./-]+", dimension
        ):
            return tool_error("CURRENT_DIMENSION_ID_REQUIRED")
        if not all(
            type(value) in (int, float)
            and -30_000_000 <= value <= 30_000_000
            and math.isfinite(value)
            for value in (x, y, z)
        ):
            return tool_error("COORDINATES_REQUIRED")
        return receipt_view(
            await self._action("walk", x=x, y=y, z=z, dimension=dimension)
        )

    async def stop(self):
        return receipt_view(await self.body.stop())

    async def result(self, *, request_id, wait=False):
        if not isinstance(request_id, str) or not re.fullmatch(
            r"[A-Za-z0-9_-]{1,48}", request_id
        ):
            return tool_error("ORIGINAL_REQUEST_ID_REQUIRED")
        if not isinstance(wait, bool):
            return tool_error("WAIT_MUST_BE_BOOLEAN")
        receipt = await self.body.result(request_id)
        if wait:
            try:
                async with asyncio.timeout(32):
                    while receipt.status == "accepted":
                        await asyncio.sleep(0.75)
                        receipt = await self.body.result(request_id)
            except TimeoutError:
                pass
        return receipt_view(receipt)

    async def inventory(self):
        data = await self._read("inventory")
        return data if data is not None else tool_error("INVENTORY_UNAVAILABLE")

    async def tasks(self):
        data = await self._read("tasks")
        return data if data is not None else tool_error("TASKS_UNAVAILABLE")

    async def task(self, *, task_id):
        return receipt_view(await self._action("task", taskId=task_id))

    async def equip(self, *, slot, hand):
        return receipt_view(await self._action("equip", slot=slot, hand=hand))

    async def spells(self):
        data = await self._read("spells")
        return data if data is not None else tool_error("SPELLS_UNAVAILABLE")

    async def cast(self, *, spell_id):
        return receipt_view(await self._action("cast", spellId=spell_id))

    async def inbox(self):
        data = await self._read("inbox")
        identity = self.body.identity()
        if (
            data is None
            or data.get("maidId") != identity.body_id
            or data.get("ownerId") != identity.owner_id
        ):
            return tool_error("INBOX_UNAVAILABLE")
        messages = [
            row
            for row in data.get("messages", [])
            if row.get("senderUuid") == identity.owner_id
            and str(row.get("eventId", "")).startswith(f"{identity.owner_id}:")
        ]
        return {
            "messages": messages,
            "sessionKey": data.get("sessionKey"),
            "memoryNamespace": data.get("memoryNamespace"),
        }

    async def speak(self, *, message, event_id=None):
        if (
            not isinstance(message, str)
            or not 1 <= len(message) <= 140
            or any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in message)
        ):
            return tool_error("PLAIN_TEXT_UP_TO_140_CHARACTERS_REQUIRED")
        if event_id is None:
            return receipt_view(await self._action("speak", text=message))
        inbox = await self.inbox()
        if not isinstance(event_id, str) or all(
            row["eventId"] != event_id for row in inbox.get("messages", [])
        ):
            return tool_error("OWNER_EVENT_NOT_PENDING")
        digest = hashlib.sha256(event_id.encode("utf-8")).hexdigest()[:32]
        spoken = await self._action(
            "speak", text=message, request_id=f"neko_reply_{digest}"
        )
        result = receipt_view(spoken)
        if spoken.status == "completed" and result.get("effectsApplied") is True:
            result["dialogueAck"] = receipt_view(
                await self._action(
                    "ack", eventId=event_id, request_id=f"neko_ack_{digest}"
                )
            )
        return result
