"""Project verified NPC dialogue and companion receipts into scoped relationship views."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import time
from tempfile import NamedTemporaryFile
from uuid import UUID

from .memory.local import features


DAY_MS = 86_400_000
LABELS = {
    "familiarity": ("初识", "认识", "熟悉"),
    "trust": ("待建立", "愿意合作", "信赖"),
}


def identifier(value) -> str | None:
    try:
        return str(UUID(value)) if isinstance(value, str) else None
    except ValueError:
        return None


def timestamp(value) -> int | None:
    if type(value) is int:
        return value if 0 < value < 253_402_300_800_000 else None
    if isinstance(value, str):
        try:
            date = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if date.tzinfo is not None:
                return timestamp(int(date.timestamp() * 1000))
        except (ValueError, OverflowError, OSError):
            pass
    return None


def read_json(path: Path, limit: int = 32768) -> dict | None:
    try:
        with path.open("rb") as stream:
            data = stream.read(limit + 1)
        row = json.loads(data) if len(data) <= limit else None
    except (OSError, ValueError, UnicodeError):
        return None
    return row if isinstance(row, dict) else None


def publish_json(path: Path, row: dict) -> None:
    data = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    if path.exists() and path.read_bytes() == data:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=path.parent, prefix=".social-", delete=False) as stream:
        temp = Path(stream.name)
        try:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
            stream.close()
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)


@dataclass(frozen=True)
class SocialEvent:
    peer_type: str
    peer_id: str
    at: int
    kind: str
    source: str
    source_id: str
    visibility: str
    summary: str
    contract: str | None = None

    @property
    def event_id(self) -> str:
        key = [self.peer_type, self.peer_id, self.kind, self.source, self.source_id]
        return str(UUID(bytes=hashlib.sha256(json.dumps(key).encode()).digest()[:16]))


def relationship_view(peer_type: str, peer_id: str, events: list[SocialEvent], public: bool, *, evidence_limit: int = 24) -> dict:
    ordered = sorted(events, key=lambda event: (event.at, event.event_id, event.summary))
    visible = {event.event_id: event for event in reversed(ordered)
               if not public or event.visibility == "public"}
    evidence = sorted(visible.values(), key=lambda event: (event.at, event.event_id))
    familiar_days = {event.at // DAY_MS for event in evidence}
    contracts, trusted_days = set(), set()
    for event in evidence:
        if event.contract and event.contract not in contracts:
            contracts.add(event.contract)
            trusted_days.add(event.at // DAY_MS)
    familiar, trust = min(10, len(familiar_days)), min(10, 2 * len(trusted_days))
    return {
        "schemaVersion": 1, "policyVersion": 1, "peer": {"type": peer_type, "id": peer_id},
        "visibility": "public" if public else "peer_only",
        "familiarity": LABELS["familiarity"][0 if not familiar else 1 if familiar < 3 else 2],
        "trust": LABELS["trust"][0 if trust < 2 else 1 if trust < 4 else 2],
        "evidence": [{"id": event.event_id, "kind": event.kind, "summary": event.summary,
                      "at": event.at, "source": event.source, "sourceRequestId": event.source_id}
                     for event in reversed(evidence[-evidence_limit:])],
        "scores": {"familiarity": familiar, "trust": trust},
        "sourceCount": len(evidence),
    }


def model_view(view: dict, topic: str = "", ranked: tuple[str, ...] = (), history: tuple[dict, ...] | None = None,
               *, graph_ranked: tuple[str, ...] = ()) -> dict:
    evidence = view["evidence"] if history is None else history
    terms = features(topic)
    relevant = [(len(terms & features(entry["summary"])), entry) for entry in evidence]
    lexical = sorted(((count, entry) for count, entry in relevant if count),
                     key=lambda match: (-match[0], -match[1]["at"], match[1]["id"]))
    keyword_rank = {entry["id"]: rank for rank, (_, entry) in enumerate(lexical)}
    semantic_rank = {source: rank for rank, source in enumerate(ranked)}
    graph_rank = {source: rank for rank, source in enumerate(graph_ranked)}

    def order(entry):
        source = entry["sourceRequestId"]
        positions = (keyword_rank.get(entry["id"]), semantic_rank.get(source), graph_rank.get(source))
        score = sum(1 / (8 + pos) for pos in positions if pos is not None)
        return -score, -entry["at"], entry["id"]

    selected = sorted(evidence, key=order)[:3]
    return {key: view[key] for key in ("schemaVersion", "policyVersion", "peer", "visibility", "familiarity", "trust")} | {
        "evidence": [{key: entry[key] for key in ("id", "kind", "summary")} for entry in selected],
    }


def stamped_contact(event, body: str, registered: dict[str, str]) -> dict | None:
    """Only a server-attributed inbox event supplies identity and channel."""
    data = event.data
    speaker = identifier(data.get("speakerId"))
    key = data.get("eventId")
    at = timestamp(data.get("occurredAt")) or timestamp(data.get("receivedAt"))
    channel = data.get("channel")
    if (data.get("serverAttributed") is not True or data.get("listenerId") != body
            or not speaker or speaker == body or not isinstance(key, str) or not 0 < len(key) <= 180
            or not at or channel not in ("chat", "voice", "npc_chat", "nearby", "public")
            or (speaker in registered and registered[speaker] == registered.get(body))):
        return None
    return {"peerType": "npc" if speaker in registered else "player", "peerId": registered.get(speaker, speaker)}


class SocialWorld:
    """One writer under the NPC service lock. Pairs are rebuilt from committed receipts."""

    def __init__(self, root: Path, realm: str, roles) -> None:
        self.root, self.realm = root, realm
        self.roles = {str(role.body_id): role for role in roles}
        self.registered = {str(body): str(role.character_id) for role in roles
                           for body in (role.body_id, *role.social_previous_bodies)}
        self.active_body = {str(role.character_id): str(role.body_id) for role in roles}
        self.history = {body: tuple(str(past) for past in role.social_previous_bodies) for body, role in self.roles.items()}
        self.recent_evidence: dict[tuple[str, str, str, bool], tuple[dict, ...]] = {}

    def contacts(self, body: str) -> list[SocialEvent]:
        events = []
        for current in (body, *self.history[body]):
            for file in (self.root / "tlm-companion-memory" / current).glob("*-result.json"):
                row = read_json(file)
                if (not row or row.get("schemaVersion") != 1 or row.get("maidId") != current
                        or row.get("status") != "answered" or row.get("kind") not in (None, "social_dialogue")):
                    continue
                source, speaker = identifier(row.get("id")), identifier(row.get("speakerId"))
                at, channel = timestamp(row.get("at")), row.get("channel")
                if not source or file.name != f"{source}-result.json" or not speaker or speaker == current or not at:
                    continue
                if channel not in ("private", "public", "nearby", "npc"):
                    continue
                if row.get("kind") == "social_dialogue":
                    submitted = read_json(file.with_name(source + "-request.json"))
                    completed = timestamp(row.get("completedAt"))
                    if (not submitted or submitted.get("status") != "accepted" or channel not in ("private", "public", "nearby")
                            or not completed or not 0 <= completed - at <= 120_000
                            or any(submitted.get(key) != row.get(key)
                                   for key in ("schemaVersion", "id", "maidId", "speakerId", "kind", "channel", "at", "message"))):
                        continue
                    at = completed
                peer = self.registered.get(speaker, speaker)
                # An older file still proves identity if it was written by the
                # player's authenticated companion command or a registered NPC.
                if peer == self.registered[body] or (channel == "npc" and speaker not in self.registered):
                    continue
                text = row.get("message")
                summary = ("曾聊过：" + " ".join(text.split())[:100]) if isinstance(text, str) and text.strip() else "曾有一次已完成的交谈"
                events.append(SocialEvent("npc" if speaker in self.registered else "player", peer, at, "dialogue_completed",
                                          "companion_journal", source, "public" if channel == "public" else "peer_only", summary))
        return events

    def arrivals(self) -> dict[str, list[SocialEvent]]:
        arrivals = defaultdict(list)
        for body in self.roles:
            for previous in (body, *self.history[body]):
                for file in (self.root / "tlm-companion-travel" / previous).glob("*.json"):
                    row = read_json(file)
                    if not row or row.get("maidId") != previous or row.get("status") != "completed" or row.get("completed") is not True:
                        continue
                    proof = row.get("socialArrival")
                    if (not isinstance(proof, dict) or proof.get("schemaVersion") != 1 or proof.get("followerId") != previous
                            or proof.get("visibility") != "peer_only"):
                        continue
                    request, contract = (identifier(row.get(key)) for key in ("requestId", "contractId"))
                    leader = identifier(proof.get("leaderId"))
                    at = timestamp(proof.get("at"))
                    if (not request or file.stem != request or not contract or not leader or leader == previous or not at
                            or self.registered.get(leader, leader) == self.registered[body]
                            or proof.get("contractId") != contract or proof.get("requestId") != request or proof.get("arrived") is not True):
                        continue
                    summary = "按同一份已同意的同行约定抵达了领队身边"
                    peer = self.registered.get(leader, leader)
                    arrivals[body].append(SocialEvent("npc" if leader in self.registered else "player", peer, at,
                                                      "shared_activity_completed", "companion_travel", request, "peer_only", summary, contract))
                    if leader in self.registered and self.registered[leader] != self.registered[body]:
                        leader_body = self.active_body[self.registered[leader]]
                        arrivals[leader_body].append(SocialEvent("npc", self.registered[body], at, "shared_activity_completed",
                                                                 "companion_travel", request, "peer_only", summary, contract))
        return arrivals

    def refresh(self) -> None:
        arrivals = self.arrivals()
        index = {}
        publish_json(self.root / "tlm-companion-memory" / "relationship-roster.json",
                     {"schemaVersion": 1, "realm": self.realm, "bodies": self.registered})
        for body, role in self.roles.items():
            directory = self.root / "tlm-companion-memory" / body
            identity = {"realm": self.realm, "maidId": str(role.character_id), "bodyId": body, "schemaVersion": 1, "policyVersion": 1}
            if not role.social_memory:
                if (directory / "relationship-ready.json").exists():
                    publish_json(directory / "relationship-ready.json", identity | {"enabled": False})
                continue
            events = self.contacts(body) + arrivals[body]
            pairs = defaultdict(list)
            for event in events:
                pairs[event.peer_type, event.peer_id].append(event)
            for path in directory.glob("relationship-*-*.json"):
                _, peer_type, peer_id = path.stem.split("-", 2)
                if peer_type in ("player", "npc") and identifier(peer_id) == peer_id:
                    pairs.setdefault((peer_type, peer_id), [])
            for (peer_type, peer_id), evidence in pairs.items():
                public = relationship_view(peer_type, peer_id, evidence, True, evidence_limit=256)
                peer_only = relationship_view(peer_type, peer_id, evidence, False, evidence_limit=256)
                index[body, peer_type, peer_id, True] = tuple(public["evidence"])
                index[body, peer_type, peer_id, False] = tuple(peer_only["evidence"])
                publish_json(directory / f"relationship-{peer_type}-{peer_id}.json", identity | {
                    "public": public | {"evidence": public["evidence"][:24]},
                    "peerOnly": peer_only | {"evidence": peer_only["evidence"][:24]},
                })
            publish_json(directory / "relationship-ready.json", identity)
        self.recent_evidence = index

    def dialogue_requests(self, role) -> list[tuple[Path, dict]]:
        if not role.social_memory:
            return []
        body = str(role.body_id)
        directory = self.root / "tlm-companion-memory" / body
        now = int(time.time() * 1000)
        requests = []
        for file in directory.glob("*-request.json"):
            row = read_json(file)
            if (not row or row.get("kind") != "social_dialogue" or row.get("maidId") != body
                    or row.get("schemaVersion") != 1 or row.get("status") != "accepted"):
                continue
            request, speaker = identifier(row.get("id")), identifier(row.get("speakerId"))
            at, text = timestamp(row.get("at")), row.get("message")
            if (not request or file.name != f"{request}-request.json" or not speaker or not at
                    or row.get("channel") not in ("private", "public", "nearby") or not 0 <= now - at <= 120_000
                    or not isinstance(text, str) or not 0 < len(text) <= 400):
                continue
            if any((directory / f"{request}-{suffix}.json").exists() for suffix in ("answer", "sending", "result")):
                continue
            requests.append((directory / f"{request}-answer.json", row))
        return sorted(requests, key=lambda item: (item[1]["at"], item[1]["id"]))[:4]

    def lookup(self, body: str, peer_type: str, peer_id: str, *, public: bool, topic: str = "",
               ranked: tuple[str, ...] = (), graph_ranked: tuple[str, ...] = ()) -> dict | None:
        role = self.roles.get(body)
        if not role or peer_type not in ("player", "npc") or identifier(peer_id) != peer_id:
            return None
        directory = self.root / "tlm-companion-memory" / body
        identity = {"realm": self.realm, "maidId": str(role.character_id), "bodyId": body, "schemaVersion": 1, "policyVersion": 1}
        if not role.social_memory or read_json(directory / "relationship-ready.json") != identity:
            return None
        path = directory / f"relationship-{peer_type}-{peer_id}.json"
        row = read_json(path)
        if row is None:
            return None if path.exists() else model_view(relationship_view(peer_type, peer_id, [], public), topic)
        if any(row.get(key) != value for key, value in identity.items()):
            return None
        try:
            view = row["public" if public else "peerOnly"]
            if view["peer"] != {"type": peer_type, "id": peer_id} or view["visibility"] != ("public" if public else "peer_only"):
                return None
            history = self.recent_evidence.get((body, peer_type, peer_id, public))
            return model_view(view, topic, ranked, history, graph_ranked=graph_ranked)
        except (KeyError, TypeError):
            return None
