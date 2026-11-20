import asyncio
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from agent_mc_harness import npc_service
from agent_mc_harness.models import BodyIdentity
from agent_mc_harness.resident_slots import BirthRegistry, binding_is_live, slot_templates
from simbody import SimBody
from test_server_npc import role


def config(kind, directory):
    def write(name, value):
        path = directory / name
        path.write_text(json.dumps(value), encoding="utf8")
        return str(path)
    body = str(uuid4())
    return {"schema": 1, "stateDirectory": str(directory / "state"), "serverId": "test",
            "rolesFile": write("roles.json", {"schema": 1, "roles": []}),
            "providers": {"tokenplan": write("provider.json", {"baseUrl": "http://127.0.0.1:3456", "apiKey": "fixture"})},
            "bodies": {"newbody": {"controllerId": str(uuid4()), "endpoint": "unused", "name": "NativeQA",
                                    "tokenFile": write("native-key.json", "unused")}},
            "residentTurns": {"newbody": {"endpoint": "http://127.0.0.1/api/v1/resident-turns/newbody"}}, "residentNamesDirectory": str(directory / "names"),
            "residentCreationSlots": {"newbody": {"bodyKind": kind, "bodyId": body, "ownerGameId": str(uuid4()),
                  "roleDefaults": {"model": "test", "provider": "tokenplan", "persona": "本地人设", "allowed_tools": ["body:observe","body:chat"]}}}}


@pytest.mark.parametrize("kind", ["maid", "numen"])
def test_new_character_joins_service_and_recovers_its_identity_while_portal_is_offline(kind, tmp_path, monkeypatch):
    settings = config(kind,tmp_path)
    slot = settings["residentCreationSlots"]["newbody"]
    profile = {"characterId":str(uuid4()), "name":"云灯", "persona":"喜欢夜间巡游。"}
    config_file = tmp_path / "service.json"
    config_file.write_text(json.dumps(settings))
    started, confirm, hosts = [], [], []
    available = False

    class Client:
        def __init__(self, role, _): self.role = role
        async def activation(self, ready=None):
            if ready:
                assert available
                assert self.role.name == profile["name"] and self.role.persona == profile["persona"]
                confirm.append(ready)
            else:
                assert not started
            return profile
        async def requested_turn(self): return None
        async def close(self): pass

    class Native(SimBody):
        def __init__(self, transport, *, scope, owner_id, **kwargs):
            super().__init__(body_id=slot["bodyId"])
            self.port = transport
            self.scope, self.owner = scope, owner_id
        def identity(self):
            return BodyIdentity(kind=kind,body_id=self.body_id,owner_id=self.owner,scope=self.scope)
        async def snapshot(self):
            scene = await super().snapshot()
            return scene.model_copy(update={"life_state": "alive" if available else "unloaded"})

    # Exercise the production service's registry, host construction, state paths and activation callback.
    async def idle(host):
        hosts.append(host)
        await host.body.spawn()
        started.append(str(host.role.character_id))
        await asyncio.Future()
    real_activate = npc_service.activate
    monkeypatch.setattr(npc_service,"activate", lambda *args: real_activate(*args,interval=0.01))
    monkeypatch.setattr(npc_service,"ResidentTurnsClient",Client)
    monkeypatch.setattr(npc_service.NpcHost,"run",idle)
    monkeypatch.setattr(npc_service,"MaidBody", Native)
    monkeypatch.setattr(npc_service,"NumenBody", Native)
    monkeypatch.setattr(npc_service,"HostedMcpPort",lambda cfg: SimpleNamespace(disconnected=asyncio.Event(), lost=False))
    monkeypatch.setattr(npc_service,"NativeMaidBridge",lambda *args, **kwargs: None)

    async def run():
        nonlocal available
        for boot in range(2):
            task = asyncio.create_task(npc_service.serve(config_file))
            try:
                async with asyncio.timeout(7):
                    while len(started) <= boot:
                        if task.done(): await task
                        await asyncio.sleep(0.01)
                    if boot == 0:
                        await asyncio.sleep(.04)
                        assert confirm == []
                        available = True
                    while len(confirm) <= boot:
                        if task.done(): await task
                        await asyncio.sleep(0.01)
                assert started[boot] == confirm[boot] == profile["characterId"]
                name = json.loads((tmp_path / "names" / (slot["bodyId"] + ".json")).read_text(encoding="utf8"))
                assert name == {"bodyId":slot["bodyId"],"bodyKind":kind,"name":profile["name"],
                                "ownerGameId":slot["ownerGameId"],"characterId":profile["characterId"]}
                assert (tmp_path / "state/newbody/actions.sqlite3").is_file()
                wrong = role(body_kind=kind)
                assert not await binding_is_live(wrong, hosts[-1].body)
            finally:
                task.cancel()
                await asyncio.gather(task,return_exceptions=True)
    asyncio.run(run())


def test_creation_capacity_cannot_repurpose_an_existing_body_or_journal(tmp_path):
    settings = config("maid",tmp_path)
    slot = settings["residentCreationSlots"]["newbody"]
    with pytest.raises(ValueError,match="already_assigned"):
        slot_templates(settings,[role(body_id=slot["bodyId"])])
    slots = slot_templates(settings,[])
    registry = BirthRegistry(tmp_path, slots, [])
    try:
        (tmp_path / "newbody").mkdir()
        with pytest.raises(ValueError,match="prior_state"):
            registry.bind(slots["newbody"],{"characterId":str(uuid4()), "name":"新角色", "persona":""})
    finally:
        registry.db.close()
