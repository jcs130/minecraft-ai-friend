"""Small message protocol over the runtime (subset of the TS gateway's v1 messages, transport-agnostic).

    {"v":1,"id":"c-1","type":"submit_intent","payload":{"goal":"...","priority":"high","constraints":{"steps":[...]}}}
    -> {"v":1,"id":"c-1","type":"result","ok":true,"payload":{"intentId":"...","state":"queued"}}

Types: hello, submit_intent, update_intent, control, get_summary, pull_events, get_body, ping. Authentication,
tenancy and transports (WS/HTTP/SSE) are the host's job - the TS gateway (packages/agent-harness) already has them.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from .models import BODY_PROTOCOL
from .runtime import HarnessRuntime

PROTOCOL = "agent-mc-harness/v1"


class Constraints(BaseModel):
    steps: list[dict[str, Any]] | None = Field(default=None, min_length=1, max_length=20)
    candidates: list[dict[str, Any]] | None = Field(default=None, min_length=2, max_length=8)  # System 1 options {id, description, step}


class SubmitIntent(BaseModel):
    goal: str = Field(min_length=1, max_length=500)
    priority: int | Literal["low", "normal", "high", "urgent"] = 50
    constraints: Constraints = Field(default_factory=Constraints)


class UpdateIntent(BaseModel):
    intentId: str
    goal: str | None = Field(default=None, max_length=500)
    priority: int | None = Field(default=None, ge=0, le=100)
    constraints: Constraints | None = None


class Control(BaseModel):
    action: Literal["pause", "resume", "cancel", "get", "list"]
    intentId: str | None = None
    reason: str | None = Field(default=None, max_length=200)


class GetSummary(BaseModel):
    topic: str | None = Field(default=None, max_length=100)
    maxChars: int = Field(default=1200, ge=200, le=4000)


class PullEvents(BaseModel):
    after: int = Field(default=0, ge=0)
    limit: int = Field(default=50, ge=1, le=100)
    minSeverity: Literal[1, 2, 3] = 1
    kinds: list[str] | None = None


class GetBody(BaseModel):
    include: list[Literal["capabilities", "health", "snapshot"]] = Field(default_factory=lambda: ["capabilities", "health"])  # type: ignore[arg-type]


def _dump(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json", by_alias=True, exclude_none=True)
    if isinstance(value, list):
        return [_dump(v) for v in value]
    if isinstance(value, dict):
        return {k: _dump(v) for k, v in value.items()}
    return value


async def handle(runtime: HarnessRuntime, message: dict[str, Any], *, agent: str = "host", admin: bool = False) -> dict[str, Any]:
    mid, kind, payload = message.get("id"), message.get("type"), message.get("payload") or {}

    def ok(body: Any, type_: str = "result") -> dict[str, Any]:
        return {"v": 1, "id": mid, "type": type_, "ok": True, "payload": _dump(body)}

    def err(code: str, text: str) -> dict[str, Any]:
        return {"v": 1, "id": mid, "type": "error", "ok": False, "payload": {"code": code, "message": text[:500]}}

    if message.get("v") != 1 or not isinstance(payload, dict):
        return err("bad_request", "expected {v:1, id, type, payload:{}}")
    try:
        if kind == "hello":
            body = runtime.body
            return ok({"protocol": PROTOCOL, "agent": agent, "admin": admin, "execute": runtime.execute,
                       "body": None if body is None else {"protocol": BODY_PROTOCOL, "kind": body.kind, "lifecycle": body.lifecycle(),
                                                          "verbs": sorted(body.capabilities().actions)}}, "welcome")
        if kind == "ping":
            return ok({"nonce": payload.get("nonce"), "latest": runtime.events[-1].seq if runtime.events else 0}, "pong")
        if kind == "submit_intent":
            req = SubmitIntent(**payload)
            intent = runtime.submit_intent(req.goal, agent=agent, priority=req.priority, steps=req.constraints.steps,
                                           candidates=req.constraints.candidates)
            return ok({"intentId": intent.id, "state": intent.state})
        if kind == "update_intent":
            upd = UpdateIntent(**payload)
            if not admin and runtime.intents[upd.intentId].agent != agent:
                return err("forbidden", "not your intent")
            return ok({"intent": runtime.update_intent(upd.intentId, goal=upd.goal, priority=upd.priority,
                                                       steps=upd.constraints.steps if upd.constraints else None)})
        if kind == "control":
            ctl = Control(**payload)
            if ctl.action not in ("list",) and ctl.intentId is None:
                return err("bad_request", "intentId required")
            if ctl.intentId and not admin and runtime.intents[ctl.intentId].agent != agent and ctl.action != "get":
                return err("forbidden", "not your intent")
            result = await runtime.control(ctl.action, ctl.intentId, ctl.reason)
            if ctl.action == "list":
                return ok({"intents": [i for i in result if admin or i.agent == agent]})
            return ok({"intent": result})
        if kind == "get_summary":
            req_s = GetSummary(**payload)
            return ok({"summary": await runtime.get_summary(req_s.topic, req_s.maxChars)})
        if kind == "pull_events":
            req_p = PullEvents(**payload)
            return ok(runtime.pull_events(req_p.after, req_p.limit, req_p.minSeverity, req_p.kinds))
        if kind == "get_body":
            req_b = GetBody(**payload)
            body = runtime.body
            if body is None:
                return ok({"body": None})
            ident = body.identity()
            out: dict[str, Any] = {"kind": body.kind, "lifecycle": body.lifecycle(),
                                   "identity": None if ident is None else ident.to_wire() if admin else
                                   {k: v for k, v in ident.to_wire().items() if k not in ("scope", "ownerId")}}
            if "capabilities" in req_b.include:
                out["capabilities"] = body.capabilities().to_wire()
            if "health" in req_b.include:
                out["health"] = body.health().to_wire()
            if "snapshot" in req_b.include:
                out["snapshot"] = (await body.snapshot()).to_wire()
            return ok({"body": out})
        return err("bad_request", f"unknown type {kind}")
    except ValidationError as error:
        return err("bad_request", str(error.errors()[0].get("msg")))
    except KeyError:
        return err("not_found", "unknown intentId")
    except ValueError as error:
        return err("bad_request", str(error))
