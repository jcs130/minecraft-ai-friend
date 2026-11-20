"""Offer a decision to the scoped desktop session. The local runtime retains the body."""
import json
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

import httpx

from .resident_protocol import prepare_scene, translate_answer


class ResidentTurnsClient:
    def __init__(self, role, config, *, http=None):
        self.role = role
        url = urlsplit(config["endpoint"])
        if (url.scheme != "https" and not (url.scheme == "http" and url.hostname == "127.0.0.1")
                or not url.hostname or url.username or url.password or url.query or url.fragment
                or url.path != f"/api/v1/resident-turns/{role.id}"):
            raise ValueError("invalid_resident_turn_endpoint")
        self.endpoint = config["endpoint"]
        self.token = Path(config["tokenFile"]).read_text(encoding="ascii").strip()
        self.http = http or httpx.AsyncClient(trust_env=False, follow_redirects=False)

    async def check(self):
        try:
            response = await self.http.post(self.endpoint + "/check", json={}, headers={"Authorization": "Bearer " + self.token}, timeout=4)
            response.raise_for_status()
            data = response.json()
            request = data.get("requestId") if isinstance(data, dict) else None
            if isinstance(request, str) and str(UUID(request)) == request:
                return request
        except (httpx.HTTPError, ValueError):
            pass
        return None

    async def offer(self, kind, messages):
        role = self.role
        payload = {"bodyKind": role.body_kind, "bodyId": str(role.body_id), "characterId": str(role.character_id), "ownerGameId": str(role.owner_id),
                   "kind": kind, "instructions": messages[0]["content"],
                   "scene": prepare_scene(role, kind, json.loads(messages[1]["content"]))}
        payload["instructions"] += (
            "\nUse the exact mode, scope and sourceEventId from scene.communication.outputs. "
            "When an output has no sourceEventId, omit that argument. "
            "If outputs is empty, skip game communication and continue with a permitted action or an empty plan."
        )
        try:
            response = await self.http.post(self.endpoint + "/offer", json=payload, headers={"Authorization": "Bearer " + self.token}, timeout=39)
            response.raise_for_status()
            result = response.json()
        except (httpx.HTTPError, ValueError):
            return None
        if isinstance(result, dict) and result.get("state") == "answered" and isinstance(result.get("answer"), dict):
            answer, route = translate_answer(kind, payload["scene"], result["answer"])
            return {"id": result.get("id"), **route, "choices": [{"message": {"content": json.dumps(answer, ensure_ascii=False)}}]}
        return None

    async def activation(self, ready=None):
        payload = {"bodyKind": self.role.body_kind, "bodyId": str(self.role.body_id), "ownerGameId": str(self.role.owner_id)}
        if ready is not None:
            payload["readyCharacterId"] = ready
        response = await self.http.post(self.endpoint + "/activation", json=payload,
                                        headers={"Authorization": "Bearer " + self.token}, timeout=5)
        response.raise_for_status()
        return response.json()["activation"]

    async def close(self):
        await self.http.aclose()
