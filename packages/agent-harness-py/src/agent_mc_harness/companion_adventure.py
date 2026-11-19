"""A bounded, read-only view of the Paper world's committed adventure records."""

import asyncio
import json
import math
import re
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any
from uuid import UUID

ID = re.compile(r"[a-z0-9_-]{1,64}")
WORLDS = dict(world="minecraft:overworld", world_nether="minecraft:the_nether", world_the_end="minecraft:the_end")
EXPLORATION_GOALS = {"explore", "peak", "biome", "biome_border", "dimension", "structure", "map_hunt", "photo"}
MAX_CHECKPOINT_AGE_MS = 900_000
SnapshotReader = Callable[[Path, int], tuple[dict[str, Any], float]]


def mapping(value):
    return value if isinstance(value, dict) else {}


def rows(value):
    return value if isinstance(value, list) else []


def unsigned(value):
    return value if type(value) is int and 0 <= value < 2**63 else 0


def label(value, limit=80):
    return value if isinstance(value, str) and 0 < len(value) <= limit and value.isprintable() else None


def mentions_activity(name: str, speech: str) -> bool:
    short = name.partition("·")[0].removeprefix("原版").removeprefix("模组")
    return name in speech or (len(short) >= 4 and short in speech)


def saved_activity(run, *, until, now):
    if run:
        if run.get("fault") or run.get("storageFault") is True:
            return "faulted"
        if unsigned(run.get("pausedAt") or run.get("paused-at")):
            return "paused"
        return "active"
    return "cooldown" if until > now else "verify_entry"


class CompanionAdventure:
    """Uses the operator's AgentFriend snapshot reader, including pending-commit checks."""

    def __init__(self, directory: Path, reader: SnapshotReader, owner: UUID):
        self.directory, self.reader, self.owner = directory, reader, str(owner)
        self.state: dict[str, Any] = {}
        self.saved_at: int | None = None
        self.catalogue: dict[str, Any] = {}
        self.next_refresh = 0.0

    def _yaml(self, name, budget):
        try:
            document, saved_at = self.reader(self.directory / name, budget)
            return document, int(saved_at * 1000)
        except (OSError, ValueError, RecursionError):
            return {}, None

    def _refresh(self):
        state, saved_at = self._yaml("config.yml", 2 * 1024 * 1024)
        self.state, self.saved_at = state, saved_at
        sites, _ = self._yaml("dungeons.yml", 256 * 1024)
        season, _ = self._yaml("world-life.yml", 32 * 1024)
        tasks = {}
        for filename in ("task-market.yml", "resident-contracts.yml", "route-contracts.yml"):
            document, _ = self._yaml(filename, 256 * 1024)
            for key, raw in mapping(document.get("tasks")).items():
                if (isinstance(key, str) and ID.fullmatch(key) and (name := label(mapping(raw).get("title")))
                        and raw.get("enabled") is not False):
                    goals = {step.get("goal") for step in rows(raw.get("steps")) if isinstance(step, dict)
                             and isinstance(step.get("goal"), str)}
                    tasks["tm_" + key] = {"name": name, "exploration": bool(goals & EXPLORATION_GOALS)}
        try:
            with (self.directory / "exploration-landmarks.json").open("rb") as stream:
                raw = stream.read(16385)
            landmarks = mapping(json.loads(raw)) if len(raw) <= 16384 else {}
        except (OSError, ValueError, RecursionError):
            landmarks = {}
        self.catalogue = {"sites": mapping(sites.get("sites")), "season": season, "tasks": tasks, "landmarks": landmarks}

    async def view(self, *, audience, dimension, recent_speech, position=None):
        if time.monotonic() >= self.next_refresh:
            await asyncio.to_thread(self._refresh)
            self.next_refresh = time.monotonic() + 20
        return self._project(audience, dimension, recent_speech, position, int(time.time() * 1000))

    def _project(self, audience, dimension, recent_speech, position, now):
        state = self.state
        owner = self.owner if audience != "public" else None
        fresh = self.saved_at is not None and 0 <= now - self.saved_at <= MAX_CHECKPOINT_AGE_MS
        snapshot_status = "checkpoint" if fresh else "stale" if self.saved_at else "unavailable"
        result: dict[str, Any] = {
            "source": "agentfriend_committed_checkpoint", "state": snapshot_status, "observedAt": now,
            "stateSavedAt": self.saved_at, "season": label(self.catalogue["season"].get("season")),
        }
        trial = mapping(state.get("dungeon-active-run"))
        trial_query = "/mycli arena status --json"
        trial_status = saved_activity(trial, until=unsigned(state.get("dungeon-last-run")) + 180_000, now=now)
        trial_floors = 15 if state.get("dungeon-challenge-built") is True else 10 if state.get("dungeon-expanded") is True else 6
        tower = {"kind": "trial", "id": "trial_tower", "name": "试炼塔", "readCommand": trial_query, "floors": trial_floors,
                 "status": trial_status if fresh and state.get("dungeon-built") is True else "unconfirmed"}
        active: list[dict[str, Any]] = []
        if owner and owner in rows(trial.get("participants")):
            active.append(tower | {"floor": unsigned(trial.get("floor")) or None, "difficulty": label(trial.get("difficulty"), 24),
                                   "clearedThisFloor": trial.get("cleared") is True,
                                   "savedAt": unsigned(trial.get("saved-at")) or self.saved_at})
        site_state = mapping(state.get("site-dungeons"))
        site_runs, cooldowns = (mapping(site_state.get(key)) for key in ("runs", "cooldowns"))
        outcomes = mapping(mapping(site_state.get("outcomes")).get(owner))
        dungeons = []
        for site_id, raw in self.catalogue["sites"].items():
            if not isinstance(site_id, str) or not ID.fullmatch(site_id):
                continue
            data = mapping(raw)
            name, world, rooms = label(data.get("name")), label(data.get("world"), 64), rows(data.get("rooms"))
            if not (name and world and 1 <= len(rooms) <= 6):
                continue
            run = mapping(site_runs.get(site_id))
            status = saved_activity(run, until=unsigned(cooldowns.get(site_id)) + 120_000, now=now)
            if not run and unsigned(data.get("conquest-floor")) and mapping(state.get("conquest-world")).get("enabled") is not True:
                status = "unconfirmed"
            site = {"kind": "dungeon", "id": site_id, "name": name, "world": WORLDS.get(world, world), "rooms": len(rooms),
                    "status": status if fresh else "unconfirmed", "readCommand": f"/mycli dungeon info {site_id}",
                    "hint": label(data.get("hint"), 128)}
            dungeons.append(site)
            if owner and owner in rows(run.get("party")):
                active.append(site | {"room": min(len(rooms), unsigned(run.get("stage")) + 1),
                                      "phase": label(run.get("phase"), 24),
                                      "readCommand": f"/mycli dungeon status {site_id}"})

        landmarks = self._landmarks(dimension, recent_speech, position)
        result.update(trial=tower, dungeons=dungeons[:16], activeWithPartner=active, choices=[])
        if owner is None:
            result["choices"] = landmarks
            return result
        guild = mapping(mapping(state.get("guild-players")).get(owner))
        completed = mapping(guild.get("everDone"))
        saved_task = mapping(guild.get("active"))
        task_id = label(saved_task.get("id"), 96)
        tasks = self.catalogue["tasks"]
        active_task = {"id": task_id, "name": tasks.get(task_id, {}).get("name"), "readCommand": "/mycli guild status"}
        recent_trial = mapping(mapping(state.get("dungeon-activity-outcomes")).get(owner))
        recent_dungeons = sorted(
            [site | {key: previous.get(key) for key in ("clearedRooms", "reason", "endedAt", "rewardStatus")
                     if type(previous.get(key)) is int or label(previous.get(key))}
             for site in dungeons if (previous := mapping(outcomes.get(site["id"])))],
            key=lambda row: unsigned(row.get("endedAt")), reverse=True)
        if audience == "addressed_partner":
            market = mapping(saved_task.get("market"))
            result["partnerProgress"] = {
                "guildCompleted": unsigned(guild.get("completed")) if self.saved_at else None,
                "activeCommission": (active_task | {"stage": unsigned(market.get("step")) + 1 if market else None}) if task_id else None,
                "recentCompletedCommissions": [
                    {"id": key, "name": tasks[key]["name"], "recordedDate": date}
                    for key, date in sorted(completed.items(), key=lambda item: str(item[1]), reverse=True)
                    if key in tasks and label(date, 10)
                ][:5],
                "trialFinalClears": unsigned(mapping(state.get("dungeon-final-clears")).get(owner)) if self.saved_at else None,
                "lastTrial": {key: recent_trial.get(key) for key in ("floor", "outcome", "reason", "endedAt")
                              if type(recent_trial.get(key)) is int or label(recent_trial.get(key))},
                "recentDungeonOutcomes": recent_dungeons[:4],
            }
        if active:
            return result
        if fresh:
            endings = [{"id": tower["id"], "name": tower["name"], "endedAt": unsigned(recent_trial.get("endedAt")),
                        "reason": label(recent_trial.get("reason"))}]
            endings.extend({"id": row["id"], "name": row["name"], "endedAt": unsigned(row.get("endedAt")),
                            "reason": label(row.get("reason"))} for row in recent_dungeons)
            latest = max(endings, key=lambda row: row["endedAt"])
            avoid = None
            if 0 <= now - latest["endedAt"] <= MAX_CHECKPOINT_AGE_MS:
                # New endings can open a conversation at the same position, with a different destination.
                result["lastActivityEndedAt"] = latest["endedAt"]
                result["recentEnding"] = latest
                avoid = latest["id"]
            result["choices"] = self._suggestions(landmarks, dungeons, tower, outcomes, active_task,
                                                 completed, dimension, recent_speech, avoid)
        else:
            result["choices"] = landmarks
        return result

    def _suggestions(self, landmarks, dungeons, tower, outcomes, active_task, completed, dimension, recent_speech, avoid):
        def mentioned(place):
            return any(mentions_activity(place["name"], speech) for speech in recent_speech)

        def priority(site):
            last = mapping(outcomes.get(site["id"]))
            return last.get("reason") == "completed", site["world"] != dimension, unsigned(last.get("endedAt")), site["id"]

        choices = list(landmarks)
        choices += sorted((site for site in dungeons if site["status"] == "verify_entry" and site["id"] != avoid
                           and not mentioned(site)), key=priority)[:2]
        if tower["status"] == "verify_entry" and tower["id"] != avoid and not mentioned(tower):
            choices.append(tower)
        tasks = self.catalogue["tasks"]
        published = rows(self.catalogue["season"].get("contracts"))
        candidates = [active_task] if active_task["name"] else [
            {"id": key, "name": tasks[key]["name"], "readCommand": "/mycli guild board"}
            for key in published if isinstance(key, str) and key in tasks and key not in completed and tasks[key]["exploration"]
        ]
        choices.extend({"kind": "commission", **task} for task in candidates if not mentioned(task))
        return choices[:6]

    def _landmarks(self, dimension, recent_speech, position):
        catalog = self.catalogue["landmarks"]
        verified_at = label(catalog.get("verifiedAt"), 48)
        if catalog.get("schemaVersion") != 1 or catalog.get("source") != "formal_anvil_structure_and_block_records" or not verified_at:
            return []
        places = []
        for raw in rows(catalog.get("places"))[:24]:
            row = mapping(raw)
            name, key = label(row.get("name"), 40), label(row.get("id"), 64)
            if (not name or not key or not ID.fullmatch(key) or row.get("world") not in WORLDS.values()
                    or row.get("precision") != "horizontal_structure_reference" or row.get("entranceVerified") is not False
                    or not all(type(row.get(axis)) is int and abs(row[axis]) < 29999000 for axis in ("x", "z"))
                    or any(mentions_activity(name, speech) for speech in recent_speech)):
                continue
            places.append({"kind": "landmark", "id": key, "name": name, "world": row["world"],
                           "x": row["x"], "z": row["z"], "verifiedAt": verified_at,
                           "precision": "horizontal_structure_reference", "entranceVerified": False})
        position = mapping(position)
        has_position = all(type(position.get(axis)) in (int, float) and math.isfinite(position[axis]) for axis in ("x", "z"))

        def priority(place):
            current_world = place["world"] == dimension
            distance = math.hypot(place["x"] - position["x"], place["z"] - position["z"]) if current_world and has_position else 0
            return not current_world, distance

        return sorted(places, key=priority)[:2]
