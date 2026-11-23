"""Operator-configured NPC process. Never creates, migrates, respawns or transfers a body."""
from __future__ import annotations

import argparse
import asyncio
from collections import defaultdict
from dataclasses import dataclass
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import time
from urllib.parse import urlsplit
from uuid import UUID, uuid5
import httpx

from .body.maid import MaidBody
from .body.numen import NumenBody
from .body.hosted_mcp import HostedMcpPort
from .bridges import NativeMaidBridge
from .companion_adventure import CompanionAdventure
from .journal import ActionJournal
from .guide_roles import GUIDE_PERSONA, parse_guide_roster
from .memory.companion import CompanionRecall
from .memory.local import LocalMemory
from .memory.remote import RemoteGraphMemory
from .memory.router import MemoryRouter
from .memory.social_graph import SocialGraph
from .npc import FastSelector, ModelClient, NpcHost, NpcPlanner, load_roles
from .numen_connection import can_reopen, run_with_connection
from .resident_turns import ResidentTurnsClient
from .resident_slots import BirthRegistry, activate, slot_templates
from .resident_numen import admit_numen
from .resident_protocol import social_receipt
from .runtime import intent_health
from .social import SocialWorld, publish_json, read_json
from .status_file import StatusFile


@dataclass
class ResidentRun:
    host: NpcHost
    task: asyncio.Task[None]
    closing: asyncio.Task[None] | None = None
    released: bool = False
    unknown_requests: int = 0
    restart_after: float = 0
    restart_error: str | None = None
    external_release: bool = False
    host_closed: bool = False
    vacancy_retry_at: float | None = None

    def close_in_background(self, external=False):
        if self.closing is None:
            self.external_release = external
            self.closing = asyncio.create_task(self.close(external), name="npc-close-" + self.host.role.id)

    async def close(self, external):
        if not self.host_closed:
            await self.host.close()
            self.host_closed = True
        if external and self.host.role.body_kind == "numen":
            try:
                await self.host.body.port.wait_voluntary_release()
            except TimeoutError:
                # A surviving external controller may hold its lease for hours.
                # Only retry the read of its vacancy, not local shutdown or an action.
                self.vacancy_retry_at = time.monotonic() + 15
                raise

    def retry_external_vacancy(self, now: float):
        if (self.vacancy_retry_at is not None and now >= self.vacancy_retry_at and
                self.closing is not None and self.closing.done()):
            self.closing = None
            self.vacancy_retry_at = None
            self.close_in_background(external=True)


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def graph_connection(graphiti: dict | None) -> tuple[str, str] | None:
    mode = "local" if graphiti is None else graphiti.get("mode", "graphiti")
    if mode == "local":
        return None
    if graphiti is None or mode != "graphiti":
        raise ValueError("npc_memory_mode")
    return graphiti["endpoint"], Path(graphiti["tokenFile"]).read_text().strip()


def open_role_memory(directory: Path, connection: tuple[str, str] | None) -> MemoryRouter:
    """Both modes keep the same local journal. A sidecar uses its own durable role outbox."""
    graph = RemoteGraphMemory(*connection, directory / "graph-outbox.sqlite3") if connection else None
    return MemoryRouter(LocalMemory(directory / "memory.sqlite3"), graph)


def external_handoff(role, transport, *, now=None):
    """A trusted operator lease pauses one original native body for an external controller."""
    filename = transport.get("externalHandoffFile")
    if role.body_kind not in {"maid", "numen"} or not filename:
        return False
    marker = Path(filename)
    if not marker.is_absolute():
        raise ValueError("external_handoff_requires_absolute_path")
    try:
        row = read(marker)
    except FileNotFoundError:
        return False
    except (OSError, ValueError):
        # The native controller lease still arbitrates exclusive access on failures.
        return False
    current = time.time() if now is None else now
    until = row.get("until") if isinstance(row, dict) else None
    return (type(until) in (int, float) and current < until <= current + 180
            and row.get("bodyId") == str(role.body_id) and row.get("ownerId") == str(role.native_owner_id))


def adventure_source(settings):
    """Load the same trusted, local checkpoint reader used by Paper's activity exporter."""
    from yaml import YAMLError

    directory, reader_file = (Path(settings[key]) for key in ("directory", "stateReader"))
    if not directory.is_absolute() or not directory.is_dir() or not reader_file.is_absolute() or not reader_file.is_file():
        raise ValueError("companion_adventure_source_unavailable")
    spec = importlib.util.spec_from_file_location("paper_agentfriend_state", reader_file)
    if spec is None or spec.loader is None:
        raise ValueError("companion_adventure_reader_unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def read_checkpoint(path, limit):
        try:
            return module.read_yaml_snapshot(path, limit)
        except YAMLError as failure:
            raise ValueError("invalid_agentfriend_checkpoint") from failure

    return directory, read_checkpoint


async def serve(path: Path):
    settings = read(path)
    if settings.get("schema") != 1:
        raise ValueError("npc_service_schema")
    roles = load_roles(Path(settings["rolesFile"]))
    slots = slot_templates(settings, roles)
    source = adventure_source(settings["companionAdventure"]) if any(r.adventure_advice for r in [*roles,*slots.values()]) else None
    state = Path(settings["stateDirectory"])
    state.mkdir(parents=True, exist_ok=True)
    health_file = StatusFile(state / "health.json")
    # OS-held lock prevents a task restart or another chat from adding a second
    # control loop. Server leases additionally fence stale controller generations.
    lock = (state / "service.lock").open("a+b")
    if os.name == "nt":
        import msvcrt
        lock.seek(0)
        if lock.read(1) == b"":
            lock.write(b"1"); lock.flush()
        lock.seek(0); msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    clients = []
    residents: dict[str, ResidentRun] = {}
    social_tasks = []
    slot_tasks = {}
    social = None
    social_graph = None
    recall = None
    recall_modes = {}
    connection = graph_connection(settings.get("graphiti"))
    if settings.get("relationshipDataPath"):
        world_data = Path(settings["relationshipDataPath"])
        if not world_data.is_absolute() or not world_data.is_dir():
            raise ValueError("relationship_world_data_unavailable")
        social = SocialWorld(world_data, settings["serverId"], roles)
        if connection:
            social_graph = SocialGraph(social, RemoteGraphMemory(*connection, state / "social-graph-outbox.sqlite3"))
        if settings.get("dialogueMemory"):
            recall = CompanionRecall(settings["dialogueMemory"], world_data / "tlm-companion-memory", settings["serverId"])
    provider = {}
    for name, file in settings["providers"].items():
        private = read(file)
        provider[name] = ModelClient(private["baseUrl"], private["apiKey"])
        clients.append(provider[name])
    system1 = FastSelector(provider["tokenplan"], settings.get("systemOneModel", "decision-model-preview"))
    semaphore = asyncio.Semaphore(2)
    # An old planner may still be finishing a request when its host is rebuilt.
    role_locks = defaultdict(asyncio.Lock)
    guide_config = settings.get("guideCompanions")
    guide_online = {}
    guide_ids = set()
    guide_client = None
    guide_portal = None
    if guide_config:
        guide_endpoint = guide_config["endpoint"]
        endpoint = urlsplit(guide_endpoint)
        if ((endpoint.scheme, endpoint.hostname, endpoint.path) != ("http", "127.0.0.1", "/maid-body")
                or endpoint.query or endpoint.fragment or endpoint.username is not None):
            raise ValueError("guide_roster_requires_loopback_maid_port")
        if guide_config.get("provider","tokenplan") not in provider:
            raise ValueError("guide_provider_unavailable")
        guide_secret = Path(guide_config["tokenFile"]).read_text().strip()
        guide_client = httpx.AsyncClient(timeout=5, trust_env=False,
                                         headers={"Authorization": "Bearer " + guide_secret})
        if portal := guide_config.get("portal"):
            portal_endpoint = portal["endpoint"]
            url = urlsplit(portal_endpoint)
            if ((url.scheme != "https" and not (url.scheme == "http" and url.hostname == "127.0.0.1"))
                    or url.path != "/api/v1/internal/player-companions" or url.query or url.fragment or url.username is not None):
                raise ValueError("companion_portal_endpoint_invalid")
            guide_portal = httpx.AsyncClient(timeout=5, trust_env=False,
                headers={"Authorization": "Bearer " + Path(portal["tokenFile"]).read_text().strip()})

    def handoff(role):
        if role.id in guide_ids:
            return role.id not in guide_online
        return external_handoff(role, settings["bodies"][role.id])

    async def start_local(host, delay=0, returning=False):
        if delay:
            await asyncio.sleep(delay)
        if not maintenance() and not handoff(host.role):
            if host.role.body_kind == "numen":
                if returning and not await host.body.port.wait_for_return(
                        lambda: maintenance() or handoff(host.role)):
                    return
                if settings.get("residentCreationSlots", {}).get(host.role.id, {}).get("numenAdmission"):
                    await prepare_numen(host.role)
                    if maintenance() or handoff(host.role):
                        return
                await run_with_connection(host)
            else:
                await host.run()

    def maintenance():
        return bool(settings.get("pauseFile") and Path(settings["pauseFile"]).exists())

    async def project_social():
        while True:
            if not maintenance():
                try:
                    await asyncio.to_thread(social.refresh)
                    if social_graph:
                        await social_graph.project()
                except (OSError, ValueError, sqlite3.Error) as failure:
                    print(f"NPC relationship projection unavailable: {type(failure).__name__}", flush=True)
            await asyncio.sleep(10)

    async def power_recall(body, request):
        return await recall.search(body, request) if recall else ((), "local")

    async def answer_social(role):
        body = str(role.body_id)
        awaiting = {}
        while True:
            resident = residents[role.id]
            if resident.closing is None and not maintenance() and not handoff(role):
                planner = resident.host.planner
                for request, (target, source, expiry) in list(awaiting.items()):
                    receipt = social_receipt(source, await asyncio.to_thread(read_json, target))
                    if receipt:
                        planner.social_receipts[request] = receipt
                        if len(planner.social_receipts) > 4:
                            del planner.social_receipts[next(iter(planner.social_receipts))]
                    if time.monotonic() > expiry or receipt and receipt.get("voice", {}).get("state") != "submitted":
                        del awaiting[request]
                for answer, row in await asyncio.to_thread(social.dialogue_requests, role):
                    speaker = row["speakerId"]
                    peer = social.registered.get(speaker, speaker)
                    peer_type = "npc" if speaker in social.registered else "player"
                    public = row["channel"] != "private"
                    try:
                        if social_graph:
                            (ranked, mode), graph_ranked = await asyncio.gather(
                                power_recall(body, row["id"]), social_graph.search(body, peer_type, peer, public=public, topic=row["message"]))
                        else:
                            ranked, mode = await power_recall(body, row["id"])
                            graph_ranked = ()
                        recall_modes[role.id] = mode
                        relationship = await asyncio.to_thread(social.lookup, body, peer_type, peer, public=public,
                                                               topic=row["message"], ranked=ranked, graph_ranked=graph_ranked)
                        reply = await planner.prepare_dialogue(row["message"], relationship, public=public, row=row)
                        response = {"status": "prepared", **reply}
                    except Exception:
                        response = {"status": "failed", "reason": "dialogue_reply_unavailable"}
                    if maintenance() or handoff(role) or residents[role.id] is not resident or resident.closing is not None:
                        break
                    try:
                        await asyncio.to_thread(publish_json, answer, response | {
                            "schemaVersion": 1, "id": row["id"], "maidId": body, "speakerId": speaker, "channel": row["channel"]})
                        if planner.resident_turns and response.get("status") == "prepared":
                            awaiting[row["id"]] = (answer.with_name(row["id"] + "-result.json"), row, time.monotonic() + 130)
                            if len(awaiting) > 32:
                                del awaiting[next(iter(awaiting))]
                    except OSError as failure:
                        print(f"NPC dialogue result unavailable: {type(failure).__name__}", flush=True)
            await asyncio.sleep(2)

    turns = {}
    for role in [*roles, *slots.values()]:
        if config := settings.get("residentTurns", {}).get(role.id):
            turns[role.id] = ResidentTurnsClient(role, config)
            clients.append(turns[role.id])

    def build(role):
        transport = settings["bodies"][role.id]
        scope = role.scope(settings["serverId"])
        native_owner = str(role.native_owner_id)
        controller = str(UUID(transport["controllerId"]))
        journal = ActionJournal(state / role.id / "actions.sqlite3")
        if role.body_kind == "maid":
            bridge = NativeMaidBridge(transport["endpoint"], Path(transport["tokenFile"]).read_text().strip(),
                                      owner_id=native_owner, maid_id=str(role.body_id), controller_id=controller)
            body = MaidBody(bridge, scope=scope, owner_id=native_owner, maid_id=str(role.body_id), server_id=settings["serverId"])
        else:
            if settings.get("residentCreationSlots", {}).get(role.id, {}).get("numenAdmission"):
                transport = {**transport, "tokenFile": state / role.id / "numen" / "hosted.token"}
            port = HostedMcpPort({**transport, "name": transport["name"], "bodyId":str(role.body_id),
                                  "ownerId":native_owner, "serverId":settings["serverId"],
                                  "journalDirectory":str(state / role.id / "numen")}, action_journal=journal)
            body = NumenBody(port, scope=scope, server_id=settings["serverId"], name=transport["name"], owner_id=native_owner,
                             item_use_ids=tuple(role.native_items), adventure_partner=role.adventure_partner)
        memory = open_role_memory(state / role.id, connection)
        planner = NpcPlanner(role, provider[role.provider], semaphore=semaphore, role_lock=role_locks[role.id],
                             fast=system1, resident_turns=turns.get(role.id))
        return NpcHost(role, body, planner,
                       memory, journal, social=social, social_graph=social_graph,
                       companion_adventure=CompanionAdventure(*source, role.owner_id) if role.adventure_advice and source else None)
    def launch(host, delay=0, returning=False):
        residents[host.role.id] = ResidentRun(
            host, asyncio.create_task(start_local(host, delay, returning), name="npc-" + host.role.id))

    def attach(role, *, player_guide=False):
        nonlocal social
        if any(r.id == role.id for r in roles):
            raise ValueError("resident_slot_duplicate_host")
        host = build(role)
        roles.append(role)
        if role.id in turns:
            turns[role.id].role = role
        if not player_guide and (directory := settings.get("residentNamesDirectory")):
            publish_json(Path(directory) / (str(role.body_id) + ".json"),
                         {"bodyId": str(role.body_id), "bodyKind": role.body_kind, "ownerGameId": str(role.owner_id),
                          "characterId": str(role.character_id), "name": role.name})
        if social is not None and not player_guide:
            social = SocialWorld(world_data, settings["serverId"], roles)
            host.social = social
            for resident in residents.values():
                resident.host.social = social
            if social_graph:
                social_graph.world = social
        launch(host)
        if social and role.social_memory:
            social_tasks.append(asyncio.create_task(answer_social(role), name="npc-dialogue-" + role.id))

    def current_body(role_id):
        return residents[role_id].host.body

    async def prepare_numen(role):
        if maintenance():
            raise RuntimeError("resident_admission_paused")
        cfg = settings["residentCreationSlots"][role.id]["numenAdmission"]
        await admit_numen(role, cfg, settings["bodies"][role.id], state / role.id / "numen" / "hosted.token")

    registry = None
    try:
        if slots or (state / "resident-births.sqlite3").exists():
            registry = BirthRegistry(state, slots, roles)
        for role in roles:
            launch(build(role))
        if social:
            if social_graph:
                social_graph.graph.start()
            social_tasks.append(asyncio.create_task(project_social(), name="npc-relationships"))
            social_tasks.extend(asyncio.create_task(answer_social(role), name="npc-dialogue-" + role.id)
                                for role in roles if role.social_memory)
        for slot_id, template in slots.items():
            slot_tasks[slot_id] = asyncio.create_task(activate(template, registry, turns[slot_id], attach, current_body),
                                                      name="resident-birth-" + slot_id)
        next_guides = 0.0
        profiles = {}
        while True:
            pausing = maintenance()
            status = {"schema": 1, "pid": os.getpid(), "pausing": pausing, "roles": []}
            if guide_client and not pausing and time.monotonic() >= next_guides:
                next_guides = time.monotonic() + 6
                try:
                    response = await guide_client.post(guide_endpoint, json={"operation": "guide_list"})
                    response.raise_for_status()
                    roster = response.json()
                    online = parse_guide_roster(roster, settings["serverId"], guide_config)
                    if guide_portal:
                        try:
                            posted = await guide_portal.post(portal_endpoint, json={"guides":roster["guides"]})
                            posted.raise_for_status()
                            wanted = {row["maidId"]:row for row in posted.json()["profiles"]}
                            for row in roster["guides"]:
                                profile = wanted.get(row["maidId"])
                                if not profile or profile["ownerId"] != row["ownerId"]:
                                    continue
                                revision = profile["revision"]
                                if revision > row.get("profileRevision", 0):
                                    applied = await guide_client.post(guide_endpoint, json={
                                        "operation":"guide_profile","ownerId":row["ownerId"],"maidId":row["maidId"],
                                        "profileRevision":revision,"name":profile["name"],
                                    })
                                    applied.raise_for_status()
                                    if not applied.json().get("applied"):
                                        continue
                                    row["name"] = profile["name"]
                                elif revision < row.get("profileRevision", 0):
                                    continue
                                profiles[row["maidId"]] = profile["persona"]
                            online = parse_guide_roster(roster, settings["serverId"], guide_config)
                        except (httpx.HTTPError, ValueError, KeyError, TypeError) as failure:
                            status["guidePortal"] = {"state":"unavailable","reason":type(failure).__name__}
                    for role_id, role in online.items():
                        if persona := profiles.get(str(role.body_id)):
                            role.persona = "玩家自设人设：" + persona + "\n" + GUIDE_PERSONA
                        if role_id in guide_ids:
                            host = residents[role_id].host
                            if host.role.body_id != role.body_id:
                                raise ValueError("guide_body_changed")
                            host.role.name = role.name
                            host.role.persona = role.persona
                            continue
                        if role_id in settings["bodies"] or any(active.body_id == role.body_id for active in roles):
                            raise ValueError("guide_identity_already_bound")
                        settings["bodies"][role_id] = {
                            "endpoint": guide_endpoint, "tokenFile": guide_config["tokenFile"],
                            "controllerId": str(uuid5(role.character_id, "guide-controller")),
                        }
                        try:
                            attach(role, player_guide=True)
                        except Exception:
                            settings["bodies"].pop(role_id, None)
                            raise
                        guide_ids.add(role_id)
                    guide_online = online
                    status["guideDiscovery"] = {"state": "ready", "online": len(online)}
                except (ValueError, TypeError, KeyError, OSError, sqlite3.Error, httpx.HTTPError) as failure:
                    guide_online = {}
                    status["guideDiscovery"] = {"state": "unavailable", "reason": type(failure).__name__}
            if slot_tasks:
                status["creationSlots"] = {key: ("waiting" if not task.done() else
                    "failed:" + type(task.exception()).__name__ if task.exception() else "bound")
                    for key, task in slot_tasks.items()}
            for resident in residents.values():
                host, task = resident.host, resident.task
                holding = handoff(host.role)
                paused = pausing or holding
                if paused != host.pausing:
                    host.pausing = paused
                    host.wake.set()
                error = type(task.exception()).__name__ if task.done() and not task.cancelled() and task.exception() else None
                if resident.closing is not None and resident.closing.done():
                    if resident.closing.cancelled():
                        error = "close_cancelled"
                    elif failure := resident.closing.exception():
                        error = "close_" + type(failure).__name__
                    else:
                        resident.released = True
                        error = resident.restart_error or error
                if resident.closing is None:
                    resident.unknown_requests = len(host.journal.unresolved(str(host.role.body_id)))
                row = {"id": host.role.id, "characterId": str(host.role.character_id),
                                        "bodyKind": host.role.body_kind, "bodyId": str(host.role.body_id),
                                        "model": host.role.model, "provider": host.role.provider, "running": not task.done(), "error": error,
                                        "health": host.body.health().model_dump(mode="json"), "route": host.planner.last_route,
                                        "memory": host.memory.status,
                                        "dialogueMemory": recall_modes.get(host.role.id),
                                        "socialGraphiti": social_graph.last.get(str(host.role.body_id)) if social_graph else None,
                                        "lastTransfer": host.companions.last_transfer if host.companions else None,
                                        "unknownRequests": resident.unknown_requests,
                                        "autonomy": host.autonomy_status(),
                                        "intents": [intent_health(intent, host.journal if resident.closing is None else None,
                                                                  str(host.role.body_id))
                                                    for intent in list(host.runtime.intents.values())[-8:]]}
                status["roles"].append(row)
                if resident.closing is not None and not resident.closing.done():
                    row["controlMode"] = "closing"
                elif resident.vacancy_retry_at is not None:
                    row["controlMode"] = "waiting_for_external_release"
                elif resident.closing is not None and not resident.released:
                    row["controlMode"] = "close_failed"
                if resident.released and holding:
                    row.update(controlMode="available_for_external_controller", unknownRequests=0)
                if not task.done():
                    continue
                if resident.vacancy_retry_at is not None:
                    if not pausing:
                        resident.retry_external_vacancy(time.monotonic())
                    continue
                if holding:
                    if row["unknownRequests"] == 0:
                        resident.close_in_background(external=True)
                elif not pausing and (can_reopen(host) or resident.released and resident.external_release):
                    if resident.released:
                        if time.monotonic() >= resident.restart_after:
                            try:
                                replacement = build(host.role)
                            except (ValueError, OSError, sqlite3.Error) as failure:
                                resident.restart_error = "reopen_" + type(failure).__name__
                                resident.restart_after = time.monotonic() + 15
                            else:
                                launch(replacement, 15, returning=resident.external_release)
                    else:
                        # A slow or failed close belongs to this body. Do not
                        # launch another controller before the old one releases it.
                        resident.close_in_background()
            await asyncio.to_thread(health_file.publish, status)
            if pausing and all(resident.task.done() for resident in residents.values()):
                return
            await asyncio.sleep(2)
    finally:
        tasks = [resident.task for resident in residents.values()]
        for task in [*slot_tasks.values(), *tasks, *social_tasks]:
            task.cancel()
        await asyncio.gather(*slot_tasks.values(), *tasks, *social_tasks, return_exceptions=True)
        for resident in residents.values():
            resident.close_in_background()
        results = await asyncio.gather(*(resident.closing for resident in residents.values()), return_exceptions=True)
        for resident, result in zip(residents.values(), results, strict=True):
            if isinstance(result, BaseException):
                print(f"NPC {resident.host.role.id} close failed: {type(result).__name__}", flush=True)
        if social_graph:
            await social_graph.graph.close()
        for client in clients:
            await client.close()
        if guide_client:
            await guide_client.aclose()
        if guide_portal:
            await guide_portal.aclose()
        if registry:
            registry.db.close()
        lock.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    asyncio.run(serve(args.config))


if __name__ == "__main__":
    main()
