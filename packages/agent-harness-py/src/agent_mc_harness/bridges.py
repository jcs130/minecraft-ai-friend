"""Tool bridges: the agent-mc-world MCP surface (``mc_maids``, ``mc_numen``, ``mc_events``) as seen from Python.

A bridge is anything with agent-mc-autonomy's ``MinecraftBridge`` interface: ``open()``, ``close()``, ``tools`` and
``call(name, arguments, request_id=...) -> CallToolResult dict``. Two real ones exist:

* ``agent_mc_autonomy.bridge.MinecraftBridge`` - stdio MCP to an agent-mc-world runtime (the owner's connection;
  the host registers touhou-maids ``MAID_TOOL`` as an extra tool there, see touhou-maids/agent/CONTRACT.md);
* ``core_rpc_bridge()`` - the numen-hosting loopback ``/core`` RPC (core-rpc.mjs). Same subclass that
  numen-hosting/hosted_harness.py builds inline (that one is not importable because it lives inside ``run()``).
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, Protocol
from urllib.parse import urlsplit

from ._reuse import autonomy_bridge


class ToolBridge(Protocol):
    tools: list[dict[str, Any]]

    async def open(self) -> None: ...
    async def close(self) -> None: ...
    async def call(self, name: str, arguments: dict[str, Any], *, timeout: float = 45, request_id: str | None = None,  # noqa: ASYNC109 - MinecraftBridge.call signature
                   turn_id: str | None = None, attribution: dict[str, Any] | None = None) -> dict[str, Any]: ...


class ControlChanged(RuntimeError):
    """numen-hosting fenced this controller (409 CONTROL_CHANGED). Stop; never reattach or retry."""


def text_content(result: dict[str, Any]) -> str:
    return str(autonomy_bridge().text_content(result))


def outcome(result: dict[str, Any]) -> dict[str, Any]:
    """agent-mc/v1 receipt (control/execution/events) - agent_mc_autonomy.bridge.outcome."""
    return dict(autonomy_bridge().outcome(result))


def json_text(result: dict[str, Any]) -> Any:
    try:
        return json.loads(text_content(result))
    except ValueError:
        return None


def core_rpc_bridge(endpoint: str, token: str, *, http: Any = None) -> Any:
    """MinecraftBridge over numen-hosting's per-runtime ``/core`` RPC.

    ``token`` is the short-lived local-core token numen-hosting hands to its child on stdin; never log it.
    """
    parsed = urlsplit(endpoint)
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.path != "/core" or parsed.username or parsed.query or parsed.fragment:
        raise ValueError("core_transport_must_be_loopback")
    base = autonomy_bridge().MinecraftBridge

    class CoreRpcBridge(base):  # type: ignore[misc, valid-type]
        def __init__(self) -> None:
            self.tools: list[dict[str, Any]] = []
            self.stopping = asyncio.Event()
            if http is not None:
                self.http = http
            else:
                import httpx
                self.http = httpx.AsyncClient(trust_env=False, follow_redirects=False, headers={"Authorization": "Bearer " + token})

        async def open(self) -> None:
            result = await self._request("tools")
            self.tools = result["tools"]

        async def _request(self, operation: str, *arguments: Any, timeout: float = 45) -> dict[str, Any]:  # noqa: ASYNC109
            if self.stopping.is_set():
                raise ControlChanged("CONTROL_CHANGED")
            response = await self.http.post(endpoint, json={"operation": operation, "arguments": list(arguments)}, timeout=timeout)
            if response.status_code == 409 and response.json().get("error") == "CONTROL_CHANGED":
                self.stopping.set()
                raise ControlChanged("CONTROL_CHANGED")
            if response.status_code != 200:
                raise RuntimeError("hosted_core_request_unknown_do_not_replay")
            return dict(response.json())

        async def close(self) -> None:
            await self.http.aclose()

    return CoreRpcBridge()


class EventCursor:
    """Reads ``mc_events`` pages with run + nextCursor exactly like agent-mc-autonomy's controller._poll_events."""

    def __init__(self, bridge: ToolBridge) -> None:
        self.bridge, self.run, self.cursor = bridge, None, 0

    async def read(self, limit: int = 64) -> list[dict[str, Any]]:
        if not any(t.get("name") == "mc_events" for t in self.bridge.tools):
            return []
        args: dict[str, Any] = {"after": self.cursor, "run": self.run, "limit": limit, "waitMs": 0} if self.run else {"after": 0, "limit": limit, "waitMs": 0}
        page = json_text(await self.bridge.call("mc_events", args))
        if not isinstance(page, dict):
            return []
        if page.get("run") != self.run and self.run is not None:
            self.cursor = 0
        self.run, self.cursor = page.get("run"), page.get("nextCursor", self.cursor)
        return [e for e in page.get("events", []) if isinstance(e, dict)]
