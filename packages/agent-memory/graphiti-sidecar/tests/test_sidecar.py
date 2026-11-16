from __future__ import annotations

import asyncio
import math
from datetime import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from agent_memory_sidecar import PROTOCOL
from agent_memory_sidecar.app import create_app
from agent_memory_sidecar.config import load_settings
from agent_memory_sidecar.embedder import HashEmbedder, hash_embed


class FakeService:
    def __init__(self) -> None:
        self.episodes: list[tuple[str, Any, list[str]]] = []
        self.searches: list[dict[str, Any]] = []

    async def health(self) -> dict[str, Any]:
        return {"ok": True, "driver": "fake", "llm": "fake", "embedder": "hash-8"}

    async def add_episode(self, group_id, episode, hints):
        self.episodes.append((group_id, episode, hints))
        return {"episode_uuid": "u1", "edges": [], "invalidated": []}

    async def search(self, group_id, query, limit, at, known_at, history):
        self.searches.append({"group_id": group_id, "query": query, "limit": limit, "at": at, "known_at": known_at, "history": history})
        return []

    async def close(self) -> None:
        pass


def test_settings_reference_keys_by_env_name_only():
    s = load_settings({"AGENT_MEMORY_LLM_BASE_URL": "https://api.deepseek.com/v1", "AGENT_MEMORY_LLM_MODEL": "deepseek-chat",
                       "AGENT_MEMORY_LLM_API_KEY_ENV": "SOME_KEY_NAME"})
    assert s.llm.structured_output == "json_object"
    assert s.driver == "kuzu" and s.embedder.kind == "hash" and s.host == "127.0.0.1"
    assert "api.deepseek.com" in s.llm.describe()
    with pytest.raises(ValueError):
        load_settings({"AGENT_MEMORY_LLM_API_KEY_ENV": "sk-this-looks-like-a-key!"})
    with pytest.raises(ValueError):
        load_settings({"AGENT_MEMORY_GRAPH_DRIVER": "neo4j"})


def test_hash_embedder_is_deterministic_normalized_and_lexical():
    a, b, c = hash_embed("Steve likes redstone", 64), hash_embed("Steve likes redstone", 64), hash_embed("钓鱼 挂机", 64)
    assert a == b and len(a) == 64
    assert math.isclose(sum(v * v for v in a), 1.0, rel_tol=1e-9)
    dot = lambda x, y: sum(p * q for p, q in zip(x, y))  # noqa: E731
    assert dot(a, hash_embed("redstone Steve", 64)) > dot(a, c)
    assert asyncio.run(HashEmbedder(16).create_batch(["x", "y"]))[0] == hash_embed("x", 16)


def test_http_contract_and_validation():
    svc = FakeService()
    client = TestClient(create_app(svc))
    assert client.get("/health").json()["ok"] is True
    body = {"protocol": PROTOCOL, "group_id": "mc_abc", "hints": ["Player:Steve HOME_AT Location:x = 1,2,3"],
            "episode": {"id": "e1", "kind": "home", "name": "home:e1", "body": "Steve set home",
                        "reference_time": "2026-11-01T00:00:00Z", "actors": ["Steve"]}}
    assert client.post("/episodes", json=body).status_code == 200
    assert svc.episodes[0][0] == "mc_abc" and svc.episodes[0][1].reference_time == datetime.fromisoformat("2026-11-01T00:00:00+00:00")
    assert client.post("/episodes", json={**body, "group_id": "bad group!"}).status_code == 422
    assert client.post("/episodes", json={**body, "protocol": "other/v9"}).status_code == 422
    r = client.post("/search", json={"protocol": PROTOCOL, "group_id": "mc_abc", "query": "Steve", "at": "2026-11-03T00:00:00Z"})
    assert r.json() == {"facts": []} and svc.searches[0]["at"] is not None


def test_bearer_token_required_when_configured():
    client = TestClient(create_app(FakeService(), token="t0k"))
    assert client.get("/health").status_code == 401
    assert client.get("/health", headers={"authorization": "Bearer t0k"}).status_code == 200
