"""Operator-configured NPC process. Never creates, migrates, respawns or transfers a body."""
from __future__ import annotations

import argparse
import asyncio
from collections import defaultdict
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import time
from uuid import UUID

from .body.maid import MaidBody
from .body.numen import NumenBody
from .body.hosted_mcp import HostedMcpPort
from .bridges import NativeMaidBridge
from .companion_adventure import CompanionAdventure
from .journal import ActionJournal
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
from .social import SocialWorld, publish_json, read_json
from .status_file import StatusFile


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
    """A trusted operator lease pauses one original maid, even if the LAN relay exits unexpectedly."""
    filename = transport.get("externalHandoffFile")
    if role.body_kind != "maid" or not filename:
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
            and row.get("bodyId") == str(role.body_id) and row.get("ownerId") == str(role.owner_id))


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
    clients, hosts, tasks = [], [], []
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
    def handoff(role):
        return external_handoff(role, settings["bodies"][role.id])

    async def start_local(host, delay=0):
        if delay:
            await asyncio.sleep(delay)
        if not maintenance() and not handoff(host.role):
            if host.role.body_kind == "numen":
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

    async def answer_social(role, planner):
        body = str(role.body_id)
        awaiting = {}
        while True:
            if not maintenance() and not handoff(role):
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
                    if maintenance() or handoff(role):
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
        controller = str(UUID(transport["controllerId"]))
        journal = ActionJournal(state / role.id / "actions.sqlite3")
        if role.body_kind == "maid":
            bridge = NativeMaidBridge(transport["endpoint"], Path(transport["tokenFile"]).read_text().strip(),
                                      owner_id=str(role.owner_id), maid_id=str(role.body_id), controller_id=controller)
            body = MaidBody(bridge, scope=scope, owner_id=str(role.owner_id), maid_id=str(role.body_id), server_id=settings["serverId"])
        else:
            if settings.get("residentCreationSlots", {}).get(role.id, {}).get("numenAdmission"):
                transport = {**transport, "tokenFile": state / role.id / "numen" / "hosted.token"}
            port = HostedMcpPort({**transport, "name": transport["name"], "bodyId":str(role.body_id),
                                  "ownerId":str(role.owner_id), "serverId":settings["serverId"],
                                  "journalDirectory":str(state / role.id / "numen")}, action_journal=journal)
            body = NumenBody(port, scope=scope, server_id=settings["serverId"], name=role.name, owner_id=str(role.owner_id),
                             item_use_ids=tuple(role.native_items), adventure_partner=role.adventure_partner)
        memory = open_role_memory(state / role.id, connection)
        planner = NpcPlanner(role, provider[role.provider], semaphore=semaphore, role_lock=role_locks[role.id],
                             fast=system1, resident_turns=turns.get(role.id))
        return NpcHost(role, body, planner,
                       memory, journal, social=social, social_graph=social_graph,
                       companion_adventure=CompanionAdventure(*source, role.owner_id) if role.adventure_advice and source else None)
    yielded = {}
    def attach(role):
        nonlocal social
        if any(r.id == role.id for r in roles):
            raise ValueError("resident_slot_duplicate_host")
        roles.append(role)
        turns[role.id].role = role
        if directory := settings.get("residentNamesDirectory"):
            publish_json(Path(directory) / (str(role.body_id) + ".json"),
                         {"bodyId": str(role.body_id), "bodyKind": role.body_kind, "ownerGameId": str(role.owner_id),
                          "characterId": str(role.character_id), "name": role.name})
        if social is not None:
            social = SocialWorld(world_data, settings["serverId"], roles)
            for existing in hosts:
                existing.social = social
            if social_graph:
                social_graph.world = social
        host = build(role)
        hosts.append(host)
        tasks.append(asyncio.create_task(start_local(host), name="npc-" + role.id))
        if social and role.social_memory:
            social_tasks.append(asyncio.create_task(answer_social(role, host.planner), name="npc-dialogue-" + role.id))

    def current_body(role_id):
        return next(host.body for host in hosts if host.role.id == role_id)

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
            host = build(role)
            hosts.append(host)
            tasks.append(asyncio.create_task(start_local(host), name="npc-" + role.id))
        if social:
            if social_graph:
                social_graph.graph.start()
            social_tasks.append(asyncio.create_task(project_social(), name="npc-relationships"))
            social_tasks.extend(asyncio.create_task(answer_social(host.role, host.planner), name="npc-dialogue-" + host.role.id)
                                for host in hosts if host.role.social_memory)
        for slot_id, template in slots.items():
            slot_tasks[slot_id] = asyncio.create_task(activate(template, registry, turns[slot_id], attach, current_body),
                                                      name="resident-birth-" + slot_id)
        while True:
            pausing = maintenance()
            holding = [handoff(host.role) for host in hosts]
            status = {"schema": 1, "pid": os.getpid(), "pausing": pausing, "roles": []}
            if slot_tasks:
                status["creationSlots"] = {key: ("waiting" if not task.done() else
                    "failed:" + type(task.exception()).__name__ if task.exception() else "bound")
                    for key, task in slot_tasks.items()}
            for index, (host, task) in enumerate(list(zip(hosts, tasks, strict=True))):
                paused = pausing or holding[index]
                if paused != host.pausing:
                    host.pausing = paused
                    host.wake.set()
                if index in yielded:
                    status["roles"].append(yielded[index])
                    continue
                error = type(task.exception()).__name__ if task.done() and not task.cancelled() and task.exception() else None
                status["roles"].append({"id": host.role.id, "characterId": str(host.role.character_id),
                                        "bodyKind": host.role.body_kind, "bodyId": str(host.role.body_id),
                                        "model": host.role.model, "provider": host.role.provider, "running": not task.done(), "error": error,
                                        "health": host.body.health().model_dump(mode="json"), "route": host.planner.last_route,
                                        "memory": host.memory.status,
                                        "dialogueMemory": recall_modes.get(host.role.id),
                                        "socialGraphiti": social_graph.last.get(str(host.role.body_id)) if social_graph else None,
                                        "unknownRequests": len(host.journal.unresolved(str(host.role.body_id))),
                                        "intents": [{"id": i.id, "state": i.state, "reason": i.reason} for i in list(host.runtime.intents.values())[-8:]]})
                if holding[index] and task.done() and not status["roles"][-1]["unknownRequests"]:
                    await host.close()
                    row = status["roles"][-1]
                    row.update(running=False, controlMode="available_for_external_controller")
                    row["health"] = host.body.health().model_dump(mode="json")
                    yielded[index] = row
            await asyncio.to_thread(health_file.publish, status)
            if all(task.done() for task in tasks) and pausing:
                return
            if not pausing:
                # One unloaded body must not interrupt other characters' active
                # actions. Re-open only that actor with its original journals.
                for index,task in enumerate(tasks[:len(holding)]):
                    if task.done() and not holding[index] and can_reopen(hosts[index]):
                        if yielded.pop(index, None) is None:
                            await hosts[index].close()
                        hosts[index]=build(roles[index])
                        tasks[index]=asyncio.create_task(start_local(hosts[index], 15), name="npc-"+roles[index].id)
            await asyncio.sleep(2)
    finally:
        for task in [*slot_tasks.values(), *tasks, *social_tasks]:
            task.cancel()
        await asyncio.gather(*slot_tasks.values(), *tasks, *social_tasks, return_exceptions=True)
        for index, host in enumerate(hosts):
            if index not in yielded:
                await host.close()
        if social_graph:
            await social_graph.graph.close()
        for client in clients:
            await client.close()
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
