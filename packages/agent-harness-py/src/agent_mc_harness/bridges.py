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
from uuid import UUID

from ._reuse import autonomy_bridge


class ToolBridge(Protocol):
    tools: list[dict[str, Any]]

    async def open(self) -> None: ...
    async def close(self) -> None: ...
    async def call(self, name: str, arguments: dict[str, Any], *, timeout: float = 45, request_id: str | None = None,  # noqa: ASYNC109 - MinecraftBridge.call signature
                   turn_id: str | None = None, attribution: dict[str, Any] | None = None) -> dict[str, Any]: ...


class ControlChanged(RuntimeError):
    """The server fenced this controller. Stop; never reattach or retry automatically."""


class MaidRequestRejected(RuntimeError):
    """A request refused by the native endpoint or its local transport."""

    def __init__(self, reason: str, *, original_request: bool = False) -> None:
        super().__init__(reason)
        self.original_request = original_request


MAID_READS = frozenset({"nearby", "brain", "list", "context", "receipt", "inbox", "tasks", "inventory", "workshop",
                        "skins", "voices", "resources", "spells"})


def maid_read_only(arguments: dict[str, Any]) -> bool:
    return arguments.get("action") in MAID_READS and not (arguments.get("action") == "brain" and "choice" in arguments)


class NativeMaidBridge:
    """Authenticated, single-body local transport to the native private companion executor.

    Binding acquires a server-controlled generation. An uncertain action is queried by its original requestId.
    A stale generation permanently fences this bridge, including reconnect(), until its host explicitly hands
    control to a new instance. Configuration supplies identities and token; dialogue cannot change them.
    """

    protocol = "qiandengji-maid-body/v1"
    transport = "native private companion (loopback /maid-body)"

    def __init__(self, endpoint: str, token: str, *, owner_id: str, maid_id: str, controller_id: str,
                 http: Any = None) -> None:
        self._validate_endpoint(endpoint)
        if not token.strip() or "\n" in token or "\r" in token:
            raise ValueError("maid_transport_token_required")
        self.owner_id = str(UUID(owner_id))
        self.maid_id = str(UUID(maid_id))
        self.controller_id = str(UUID(controller_id))
        self.endpoint = endpoint
        self._token = token
        self.http = http
        self.tools: list[dict[str, Any]] = []
        self.generation: str | None = None
        self.stopping = asyncio.Event()
        self._closed = False
        self._bind_lock = asyncio.Lock()

    @staticmethod
    def _validate_endpoint(endpoint: str) -> None:
        parsed = urlsplit(endpoint)
        if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.path != "/maid-body"
                or parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.port):
            raise ValueError("maid_transport_must_be_loopback")

    def _fence(self) -> None:
        self.stopping.set()
        raise ControlChanged("CONTROL_CHANGED")

    async def _request(self, operation: str, *, timeout: float = 45, **fields: Any) -> dict[str, Any]:  # noqa: ASYNC109
        if self._closed or self.stopping.is_set():
            self._fence()
        if operation != "bind" and self.generation is None:
            raise RuntimeError("maid_body_not_bound")
        if self.http is None:
            import httpx
            self.http = httpx.AsyncClient(trust_env=False, follow_redirects=False)
        payload = {"operation": operation, "ownerId": self.owner_id, "maidId": self.maid_id,
                   "controllerId": self.controller_id, **fields}
        if operation != "bind":
            payload["generation"] = self.generation
        response = await self.http.post(self.endpoint, json=payload, headers={"Authorization": "Bearer " + self._token},
                                        timeout=timeout, follow_redirects=False)
        if response.status_code in (401, 403):
            self._fence()
        if response.status_code in (400, 409):
            try:
                error = response.json().get("error")
            except (ValueError, AttributeError):
                error = None
            if error in {"CONTROL_CHANGED", "CONTROL_EXPIRED", "CONTROL_BUSY", "RESIDENT_CONTROLLER_ACTIVE"}:
                self._fence()
            if response.status_code == 400 and error == "DIMENSION_MISMATCH":
                raise MaidRequestRejected("maid_dimension_changed_before_dispatch")
            if (response.status_code == 400 and isinstance(error, str) and
                    (error.startswith("INVALID_") or error in {"UNSUPPORTED_ACTION", "UNEXPECTED_FIELD", "REQUEST_ID_MISMATCH"})):
                raise MaidRequestRejected("native_action_rejected_before_dispatch")
            if error in {"REQUEST_CONFLICT", "REQUEST_CONFLICT_LEGACY_QUERY_ORIGINAL"}:
                raise MaidRequestRejected("request_id_conflict_query_original_request", original_request=True)
        if response.status_code != 200:
            raise RuntimeError("maid_body_request_unknown_query_original_receipt")
        try:
            envelope = response.json()
        except ValueError:
            raise RuntimeError("maid_body_invalid_envelope") from None
        if not isinstance(envelope, dict):
            raise RuntimeError("maid_body_invalid_envelope")
        expected = {"protocol": self.protocol, "ownerId": self.owner_id, "maidId": self.maid_id,
                    "controllerId": self.controller_id}
        if any(envelope.get(key) != value for key, value in expected.items()):
            self._fence()
        generation = envelope.get("generation")
        if not isinstance(generation, str) or not generation or len(generation) > 256:
            self._fence()
        if self.generation is not None and generation != self.generation:
            self._fence()
        return envelope

    async def open(self) -> None:
        async with self._bind_lock:
            if self._closed or self.stopping.is_set():
                self._fence()
            if self.generation is not None:
                return
            envelope = await self._request("bind")
            self.generation = envelope["generation"]
            try:
                offered = envelope.get("tools")
                if not isinstance(offered, list) or len(offered) != 1 or not isinstance(offered[0], dict):
                    raise ValueError("missing tools")
                tool = offered[0]
                actions = tool.get("inputSchema", {}).get("properties", {}).get("action", {}).get("enum", [])
                if tool.get("name") != "mc_maids" or not isinstance(actions, list) or not all(isinstance(a, str) for a in actions):
                    raise ValueError("invalid tools")
                if not {"list", "context", "receipt"}.issubset(actions):
                    raise ValueError("missing actions")
            except (AttributeError, TypeError, ValueError):
                await self.close()
                raise RuntimeError("maid_body_invalid_capabilities") from None
            self.tools = [tool]

    async def call(self, name: str, arguments: dict[str, Any], *, timeout: float = 45, request_id: str | None = None,  # noqa: ASYNC109
                   turn_id: str | None = None, attribution: dict[str, Any] | None = None) -> dict[str, Any]:
        if self._closed or self.stopping.is_set():
            self._fence()
        if name != "mc_maids" or not self.tools:
            raise ValueError("maid_body_tool_not_available")
        actions = self.tools[0]["inputSchema"]["properties"]["action"]["enum"]
        if arguments.get("action") not in actions:
            raise ValueError("maid_body_action_not_available")
        if arguments.get("maidId", self.maid_id) != self.maid_id or arguments.get("ownerId", self.owner_id) != self.owner_id:
            raise ValueError("maid_body_identity_mismatch")
        if {"controllerId", "generation", "operation"}.intersection(arguments):
            raise ValueError("maid_body_transport_fields_are_reserved")
        if not maid_read_only(arguments) and (not request_id or arguments.get("requestId") != request_id):
            raise ValueError("maid_body_request_id_mismatch")
        import httpx
        try:
            envelope = await self._request("call", name=name, arguments=dict(arguments), requestId=request_id, timeout=timeout)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as error:
            # This direct POST never acquired a connection. Read/write errors after
            # sending still require the server receipt for the original request.
            raise MaidRequestRejected("maid_body_not_dispatched_no_connection") from error
        result = envelope.get("result")
        if not isinstance(result, dict) or not isinstance(result.get("content"), list):
            raise RuntimeError("maid_body_invalid_result_query_original_receipt")
        return result

    async def close(self) -> None:
        if self._closed:
            return
        try:
            if self.generation is not None and not self.stopping.is_set():
                await self._request("release")
        finally:
            self._closed = True
            self.tools = []
            self._token = ""
            if self.http is not None:
                await self.http.aclose()


class MaidApiBridge(NativeMaidBridge):
    """The owner-scoped HTTPS API for the same native body and receipt protocol."""

    transport = "native private companion (HTTPS /api/v1/maid-body)"

    @staticmethod
    def _validate_endpoint(endpoint: str) -> None:
        parsed = urlsplit(endpoint)
        if (not endpoint.startswith("https://") or not parsed.hostname or parsed.path != "/api/v1/maid-body"
                or parsed.username is not None or parsed.password is not None
                or "?" in endpoint or "#" in endpoint or parsed.port == 0):
            raise ValueError("maid_api_requires_https_endpoint")

    @classmethod
    async def identify(cls, endpoint: str, token: str, *, http: Any) -> tuple[str, str]:
        cls._validate_endpoint(endpoint)
        response = await http.post(endpoint, json={"operation": "identity"},
                                   headers={"Authorization": "Bearer " + token}, timeout=8, follow_redirects=False)
        if response.status_code in (401, 403):
            raise ControlChanged("MAID_API_GRANT_DENIED")
        if response.status_code != 200:
            raise RuntimeError("maid_api_identity_unavailable")
        try:
            identity = response.json()
            if not isinstance(identity, dict) or identity.get("protocol") != cls.protocol:
                raise ValueError("invalid protocol")
            return str(UUID(identity["ownerId"])), str(UUID(identity["maidId"]))
        except (AttributeError, KeyError, TypeError, ValueError):
            raise RuntimeError("maid_api_invalid_identity") from None


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
