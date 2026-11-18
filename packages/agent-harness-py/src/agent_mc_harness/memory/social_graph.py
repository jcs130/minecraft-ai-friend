"""Use Graphiti to rank the original, pair-scoped social evidence."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
import hashlib
from itertools import islice
import json
import sqlite3
from uuid import NAMESPACE_URL, uuid5

import httpx

from .base import MemoryEpisode
from .remote import RemoteGraphMemory
from ..social import SocialWorld


class SocialGraph:
    def __init__(self, world: SocialWorld, graph: RemoteGraphMemory) -> None:
        self.world = world
        self.graph = graph
        self.last: dict[str, str] = {}

    def scope(self, body: str, peer_type: str, peer: str, public: bool) -> str:
        role = self.world.roles[body]
        fields = [self.world.realm, str(role.character_id), peer_type, peer, "public" if public else "pair"]
        return "npc_social_" + hashlib.sha256(json.dumps(fields, separators=(",", ":")).encode()).hexdigest()[:40]

    def evidence(self, body: str, peer_type: str, peer: str, public: bool) -> tuple[dict, ...]:
        views = self.world.recent_evidence
        shared = views.get((body, peer_type, peer, True), ())
        if public:
            return shared
        public_ids = {item["id"] for item in shared}
        return tuple(item for item in views.get((body, peer_type, peer, False), ()) if item["id"] not in public_ids)

    async def project(self) -> None:
        """Queue a few recent delivered exchanges. The existing outbox owns retry and deduplication."""
        budget = min(4, 16 - self.graph.pending_count())
        if budget <= 0:
            return
        fresh = []
        for body, peer_type, peer, public in self.world.recent_evidence:
            scope = self.scope(body, peer_type, peer, public)
            known = self.graph.episode_ids(scope)
            evidence = self.evidence(body, peer_type, peer, public)
            meaningful = (item for item in evidence if item["kind"] != "dialogue_completed" or
                          item["summary"].startswith("曾聊过：") and len(item["summary"].removeprefix("曾聊过：").strip()) >= 8)
            fresh.extend((scope, body, item) for item in islice(meaningful, 8) if item["id"] not in known)
        fresh.sort(key=lambda entry: (-entry[2]["at"], entry[2]["id"], entry[0]))
        for scope, body, item in fresh[:budget]:
            name = self.world.roles[body].name
            await self.graph.add(scope, MemoryEpisode(
                id=item["id"], kind=item["kind"], name=f"{name}的共同经历",
                body=f"{name}的共同经历。{item['summary']}",
                source_description="千灯纪原始交付或抵达回执。交谈内容属于当时的陈述。",
                reference_time=datetime.fromtimestamp(item["at"] / 1000, UTC), actors=[name],
                provenance={"sourceRequestId": item["sourceRequestId"]},
            ))

    async def _recall(self, body: str, peer_type: str, peer: str, public: bool, topic: str) -> tuple[tuple[str, ...], str]:
        scope = self.scope(body, peer_type, peer, public)
        try:
            indexed = self.graph.episode_ids(scope, completed=True)
            verified = {str(uuid5(NAMESPACE_URL, f"agent-mc-memory/{scope}/{item['id']}")): item["sourceRequestId"]
                        for item in self.evidence(body, peer_type, peer, public) if item["id"] in indexed}
            if not verified:
                return (), "no_evidence"
            async with asyncio.timeout(2.5):
                ranked = await self.graph.search_sources(scope, topic)
        except (httpx.HTTPError, ValueError, sqlite3.Error, TimeoutError):
            return (), "local_fallback"
        return tuple(dict.fromkeys(verified[key] for key in ranked if key in verified)), "consulted"

    async def search(self, body: str, peer_type: str, peer: str, *, public: bool, topic: str) -> tuple[str, ...]:
        if not topic.strip():
            return ()
        results = await asyncio.gather(*(self._recall(body, peer_type, peer, visible, topic)
                                         for visible in ((True,) if public else (False, True))))
        ranked = [ids for ids, _ in results]
        statuses = {status for _, status in results}
        self.last[body] = ("consulted_with_fallback" if statuses == {"consulted", "local_fallback"} else
                           "consulted" if "consulted" in statuses else
                           "local_fallback" if "local_fallback" in statuses else "no_evidence")
        # Interleave equally ranked public/shared and pair-only histories for a private reply.
        return tuple(dict.fromkeys(ids[i] for i in range(8) for ids in ranked if i < len(ids)))
