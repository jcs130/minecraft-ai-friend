"""Correlated, private native-mod requests on the existing Minecraft socket.

No model calls, new socket or game-chat output. This module stays plugin-local.
The Neko body owns the durable intent/result ledger and mutation classification.
"""
from __future__ import annotations

import asyncio
import json
import re
import uuid
from typing import Any

_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,96}$")
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

NATIVE_MOD_DESCRIPTION = (
    "读取和操作当前 Minecraft 化身的原生模组内容。先 list，再 explain 获取参数 schema，"
    "call 使用 args 对象。支持殖民地、车万女仆、Ars 法术、Create、Domum、Curios。"
    "原生库存和完整组件用 menu.current 查询；代理 player_head 等名称不代表真实模组物品。"
    "坐标使用绝对坐标。调用成功不等于任务完成，读回真实状态验证。"
    "写入使用唯一 callId，收到 unknown 后禁止换 ID 重试；用 result 查询原 callId。"
    "普通游戏行动与模组写入不能同时执行。所有结果仅本角色工具可见。"
)
NATIVE_MOD_SCHEMA = {
    "type": "object",
    "properties": {
        "operation": {"type": "string", "enum": ["list", "explain", "call", "status", "result"]},
        "id": {"type": "string", "description": "list 返回的模组操作 ID"},
        "args": {"type": "object", "description": "explain 返回的参数对象，保留完整 SNBT/组件"},
        "callId": {"type": "string", "description": "写入的唯一幂等 ID；result 查询原 ID，未知结果勿重试"},
    },
    "required": ["operation"],
    "additionalProperties": False,
}


def failure(code: str, *, uncertain: bool = False, **fields: Any) -> dict[str, Any]:
    return {"ok": False, "code": code, "outcomeKnown": not uncertain,
            "outcomeUnknown": uncertain, "retryAutomatically": False, **fields}


class NativeModRequests:
    def __init__(self) -> None:
        self.pending: dict[str, dict[str, Any]] = {}
        self.player_uuid: str | None = None
        self.socket: Any = None
        self.generation = 0
        self.uncertain_calls: set[str] = set()

    def connected(self, socket: Any) -> None:
        self.disconnected(self.socket)
        self.socket = socket
        self.generation += 1

    def disconnected(self, socket: Any) -> None:
        if socket is not self.socket:
            return
        for record in tuple(self.pending.values()):
            future = record["future"]
            if not future.done():
                if record["action"] == "call" and record["callId"]:
                    self.uncertain_calls.add(record["callId"])
                future.set_result(failure("native_transport_disconnected", uncertain=record["action"] == "call",
                                          callId=record["callId"], id=record["id"]))
        self.pending.clear()
        self.socket = None

    def receive(self, socket: Any, payload: dict[str, Any]) -> bool:
        if payload.get("type") != "native_mod_result":
            return False
        request_id = payload.get("requestId")
        if not isinstance(request_id, str):
            return True
        record = self.pending.get(request_id)
        if socket is not self.socket or record is None:
            return True  # Unsolicited/late/previous-connection data is never a receipt.
        if (payload.get("schemaVersion") != 1 or payload.get("action") != record["action"]
                or payload.get("id") != record["id"] or payload.get("callId") != record["callId"]):
            return True
        actor = payload.get("playerUuid")
        if actor is not None:
            if not isinstance(actor, str) or not _UUID.fullmatch(actor):
                return True
            actor = actor.lower()
            if self.player_uuid is not None and actor != self.player_uuid:
                return True
            self.player_uuid = actor
        # Successful native state/mutations must identify the actual player.
        if payload.get("ok") is True and actor is None:
            return True
        if record["action"] == "call" and payload.get("outcomeUnknown") is True:
            self.uncertain_calls.add(record["callId"])
        if record["action"] == "result" and payload.get("ok") is True and payload.get("outcomeUnknown") is False:
            self.uncertain_calls.discard(record["callId"])
        future = record["future"]
        if not future.done():
            future.set_result(payload)
        return True

    async def request(self, socket: Any, *, operation: str, id: str | None = None,
                      args: dict[str, Any] | None = None, callId: str | None = None,
                      timeout: float = 8.0) -> dict[str, Any]:
        if operation not in ("list", "explain", "call", "status", "result"):
            return failure("native_operation_invalid")
        if operation in ("call", "explain") and (not isinstance(id, str) or not _ID.fullmatch(id)):
            return failure("native_id_required")
        if args is not None and not isinstance(args, dict):
            return failure("native_arguments_object_required")
        if callId is not None and (not isinstance(callId, str) or not _ID.fullmatch(callId)):
            return failure("native_call_id_invalid")
        if operation == "result" and not callId:
            return failure("native_call_id_required")
        if operation == "call" and not callId:
            callId = str(uuid.uuid4())
        if operation == "call" and self.uncertain_calls:
            return failure("native_receipt_reconciliation_required", unresolved=sorted(self.uncertain_calls), callId=callId)
        if socket is None or socket is not self.socket:
            return failure("native_transport_not_connected", callId=callId, id=id)
        request_id = str(uuid.uuid4())
        message = {"type": "native_mod", "schemaVersion": 1, "requestId": request_id,
                   "action": operation, "id": id, "callId": callId, "args": args or {}}
        try:
            wire = json.dumps(message, ensure_ascii=False, allow_nan=False)
            if len(wire.encode("utf-8")) > 70000:
                return failure("native_argument_budget_exceeded", callId=callId)
        except (TypeError, ValueError):
            return failure("native_arguments_not_json", callId=callId)
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = {"future": future, "action": operation, "id": id, "callId": callId}
        try:
            await socket.send(wire)
            return await asyncio.wait_for(asyncio.shield(future), timeout)
        except asyncio.CancelledError:
            # Cancellation is not authority to retry. The body's durable callId remains queryable.
            if operation == "call":
                self.uncertain_calls.add(callId)
            raise
        except (TimeoutError, OSError, ConnectionError):
            if operation == "call":
                self.uncertain_calls.add(callId)
            return failure("native_transport_outcome_unknown", uncertain=operation == "call", callId=callId, id=id)
        except Exception:
            if operation == "call":
                self.uncertain_calls.add(callId)
            return failure("native_transport_outcome_unknown", uncertain=operation == "call", callId=callId, id=id)
        finally:
            self.pending.pop(request_id, None)
            if not future.done():
                future.cancel()
