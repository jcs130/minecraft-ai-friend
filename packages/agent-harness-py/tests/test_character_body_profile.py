import asyncio
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from agent_mc_harness import npc_service
from agent_mc_harness.models import BodyEvent, BodyIdentity, WorldRef
from agent_mc_harness.npc import load_roles
from simbody import SimBody


def profile():
    return {"id": "amber", "name": "琥珀", "character_id": str(uuid4()), "owner_id": str(uuid4()),
            "persona": "记得我在村外找到的灯塔。", "provider": "tokenplan", "model": "fixture"}


def test_registry_keeps_character_and_native_owner_fields_separate(tmp_path):
    character = profile()
    body = {"body_kind": "maid", "body_id": str(uuid4()), "allowed_tools": ["body:observe"]}
    path = tmp_path / "roles.json"
    path.write_text(json.dumps({"schema": 1, "roles": [character | body]}), encoding="utf-8")
    previous, = load_roles(path)
    path.write_text(json.dumps({"schema": 2, "roles": [{"character": character, "body": body}]}), encoding="utf-8")
    revised, = load_roles(path)
    assert previous == revised
    assert revised.native_owner_id == revised.owner_id

    body["persona"] = "Attempted body override"
    path.write_text(json.dumps({"schema": 2, "roles": [{"character": character, "body": body}]}), encoding="utf-8")
    with pytest.raises(ValueError, match="persona"):
        load_roles(path)


def test_service_rebinds_body_owner_and_preserves_persona_and_memory(tmp_path, monkeypatch, run):
    character = profile()
    maid_id, numen_id, virtual_owner = map(str, (uuid4(), uuid4(), uuid4()))
    roles_file = tmp_path / "roles.json"
    service_config = tmp_path / "service.json"
    token = tmp_path / "token"
    token.write_text("offline", encoding="utf-8")
    provider = tmp_path / "provider.json"
    provider.write_text(json.dumps({"baseUrl": "http://127.0.0.1:1/v1", "apiKey": "offline"}), encoding="utf-8")

    class NativeBody(SimBody):
        def __init__(self, transport, *, scope, owner_id, maid_id=None, name=None, server_id=None, **kwargs):
            super().__init__(body_id=maid_id or transport.settings["bodyId"])
            self.port = transport
            self.record = BodyIdentity(kind="maid" if maid_id else "numen", body_id=self.body_id,
                                       scope=scope, owner_id=owner_id, name=name,
                                       world=WorldRef(server_id=server_id))

        def identity(self):
            return self.record

    def numen_port(settings, **kwargs):
        return SimpleNamespace(settings=settings, disconnected=asyncio.Event(), lost=False)

    def daemon(kind, body_id, native_owner):
        body = {"body_kind": kind, "body_id": body_id, "body_owner_id": native_owner,
                "allowed_tools": ["body:observe"]}
        roles_file.write_text(json.dumps({"schema": 2, "roles": [{"character": character, "body": body}]}), encoding="utf-8")
        config = {"schema": 1, "serverId": "test-server", "stateDirectory": str(tmp_path / "state"),
                  "rolesFile": str(roles_file), "providers": {"tokenplan": str(provider)},
                  "bodies": {"amber": {"controllerId": str(uuid4()), "endpoint": "http://127.0.0.1:1",
                                       "tokenFile": str(token), "name": "AmberGame"}}}
        service_config.write_text(json.dumps(config), encoding="utf-8")
        return npc_service.serve(service_config)

    async def scenario():
        started = asyncio.Queue()

        async def actor(host):
            await host.body.spawn()
            ident = host.body.identity()
            if ident.kind == "maid":
                await host.memory.observe(
                    BodyEvent(kind="death", body_kind=ident.kind, body_id=ident.body_id, data={"eventId": "original-death"}),
                    ident,
                )
            facts = await host.memory.search(ident.group_id(), "死亡", limit=4)
            await started.put((ident, host.planner.role.persona, [fact.fact for fact in facts]))
            await asyncio.Future()

        monkeypatch.setattr(npc_service.NpcHost, "run", actor)
        monkeypatch.setattr(npc_service, "MaidBody", NativeBody)
        monkeypatch.setattr(npc_service, "NumenBody", NativeBody)
        monkeypatch.setattr(npc_service, "NativeMaidBridge", lambda *args, **kwargs: None)
        monkeypatch.setattr(npc_service, "HostedMcpPort", numen_port)
        seen = []
        for binding in (("maid", maid_id, character["owner_id"]), ("numen", numen_id, virtual_owner)):
            service = asyncio.create_task(daemon(*binding))
            record = asyncio.create_task(started.get())
            try:
                done, _ = await asyncio.wait((service, record), timeout=4, return_when=asyncio.FIRST_COMPLETED)
                if service in done:
                    service.result()
                assert record in done
                seen.append(record.result())
            finally:
                service.cancel()
                record.cancel()
                await asyncio.gather(service, record, return_exceptions=True)
        (maid, old_persona, old_facts), (numen, next_persona, next_facts) = seen
        assert maid.body_id == maid_id and numen.body_id == numen_id
        assert maid.owner_id == character["owner_id"] and numen.owner_id == virtual_owner
        assert maid.scope == numen.scope and numen.scope.account == character["owner_id"]
        assert maid.group_id() == numen.group_id()
        assert old_persona == next_persona == character["persona"]
        assert old_facts == next_facts == ["已确认原身体死亡。"]

    run(scenario())
