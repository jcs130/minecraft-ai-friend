"""Offer a decision to the scoped desktop session. The local runtime retains the body."""
import json
from pathlib import Path
from urllib.parse import urlsplit

import httpx


class ResidentTurnsClient:
    def __init__(self, role, config, *, http=None):
        self.role = role
        url = urlsplit(config["endpoint"])
        if (url.scheme != "https" and not (url.scheme == "http" and url.hostname == "127.0.0.1")
                or not url.hostname or url.username or url.password or url.query or url.fragment
                or url.path != f"/api/v1/resident-turns/{role.id}"):
            raise ValueError("invalid_resident_turn_endpoint")
        self.endpoint = config["endpoint"] + "/offer"
        self.token = Path(config["tokenFile"]).read_text(encoding="ascii").strip()
        self.http = http or httpx.AsyncClient(trust_env=False, follow_redirects=False)

    async def offer(self, kind, messages):
        role = self.role
        payload = {"bodyKind": role.body_kind, "bodyId": str(role.body_id), "characterId": str(role.character_id), "ownerGameId": str(role.owner_id),
                   "kind": kind, "instructions": messages[0]["content"], "scene": json.loads(messages[1]["content"])}
        try:
            response = await self.http.post(self.endpoint, json=payload, headers={"Authorization": "Bearer " + self.token}, timeout=39)
            response.raise_for_status()
            result = response.json()
        except (httpx.HTTPError, ValueError):
            return None
        if isinstance(result, dict) and result.get("state") == "answered" and isinstance(result.get("answer"), dict):
            return {"id": result.get("id"), "choices": [{"message": {"content": json.dumps(result["answer"], ensure_ascii=False)}}]}
        return None

    async def close(self):
        await self.http.aclose()
