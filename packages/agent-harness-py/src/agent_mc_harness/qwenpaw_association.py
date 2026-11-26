"""Explicit, allowlisted QwenPaw identity association; no body or model authority."""
from __future__ import annotations

import asyncio
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

import httpx

from .qwenpaw_link import Character, Link, PawLinker


class PawAssociations:
    def __init__(self, settings: dict | None, realm: str, *, request=None):
        self.enabled = isinstance(settings, dict) and settings.get("enabled") is True
        self.realm, self.linker, self.client = realm, None, None
        self.allowed: set[UUID] = set()
        self.states: dict[str, dict] = {}
        self.capacity = asyncio.Semaphore(2)
        if not self.enabled:
            return
        # The deployed QwenPaw API starts newly created Agents with default tools.
        # A dedicated instance must be explicitly selected; this is never a default production discovery route.
        if settings.get("dedicatedInstance") is not True:
            raise ValueError("dedicated_qwenpaw_instance_required")
        endpoint = urlsplit(settings.get("endpoint", ""))
        if (endpoint.scheme != "http" or endpoint.hostname != "127.0.0.1" or not endpoint.port
                or endpoint.path not in {"", "/"} or endpoint.query or endpoint.fragment or endpoint.username):
            raise ValueError("qwenpaw_loopback_origin_required")
        root = Path(settings["workspaceRoot"])
        state = Path(settings["stateFile"])
        if not root.is_absolute() or not root.is_dir() or not state.is_absolute() or not state.resolve().is_relative_to(root.resolve()):
            raise ValueError("explicit_qwenpaw_association_storage_required")
        rows = settings.get("allowedCharacters")
        if not isinstance(rows, list) or not 1 <= len(rows) <= 64:
            raise ValueError("qwenpaw_character_allowlist_required")
        for value in rows:
            if not isinstance(value, str) or str(UUID(value)) != value:
                raise ValueError("canonical_qwenpaw_character_required")
            self.allowed.add(UUID(value))
        if len(self.allowed) != len(rows):
            raise ValueError("duplicate_qwenpaw_character")
        headers = {}
        if path := settings.get("tokenFile"):
            token_file = Path(path)
            if not token_file.is_absolute():
                raise ValueError("absolute_qwenpaw_token_path_required")
            token = token_file.read_text(encoding="utf-8-sig").strip()
            if not token or "\r" in token or "\n" in token:
                raise ValueError("invalid_qwenpaw_token")
            headers["Authorization"] = "Bearer " + token
        if request is None:
            self.client = httpx.Client(base_url=settings["endpoint"].rstrip("/"), headers=headers,
                                       trust_env=False, follow_redirects=False, timeout=5)
            request = self._request
        self.linker = PawLinker(state, root, settings["instanceKey"], request)

    def _request(self, method, path, body):
        if method not in {"GET", "POST"} or path != "/api/agents":
            raise ValueError("qwenpaw_association_route_not_allowed")
        try:
            with self.client.stream(method, path, json=body) as response:
                content = bytearray()
                for chunk in response.iter_bytes():
                    content.extend(chunk)
                    if len(content) > 1024 * 1024:
                        raise ValueError("qwenpaw_response_too_large")
                import json
                return response.status_code, json.loads(content)
        except (httpx.HTTPError, ValueError):
            return 0, None  # Never log error bodies, profiles or headers.

    async def admit(self, role) -> Link | None:
        if not self.enabled or role.body_kind not in {"maid", "villager"} or role.character_id not in self.allowed:
            return None
        actor = Character(self.realm, role.character_id, role.body_id, role.native_owner_id, role.body_kind, role.name)
        async with self.capacity:
            link = await asyncio.to_thread(self.linker.ensure, actor)
        self.states[str(role.character_id)] = {"agentId": link.agent_id, "state": link.state, "detail": link.detail}
        return link

    def summary(self):
        return {"enabled": self.enabled, "characters": dict(self.states)}

    async def close(self):
        if self.client is not None:
            await asyncio.to_thread(self.client.close)
