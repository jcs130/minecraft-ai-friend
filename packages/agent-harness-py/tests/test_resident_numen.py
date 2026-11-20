import asyncio
import base64
import hashlib
import hmac
import json
import time
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest

from agent_mc_harness.npc import NpcRole
from agent_mc_harness.resident_numen import admit_numen, run_with_connection, validate_admission


def test_admit_pins_owner_body_native_name_and_refreshes_scoped_token(run, tmp_path):
    key = b"x"*32
    keyfile = tmp_path / "control.key"
    keyfile.write_bytes(key)
    role = NpcRole(id="original", name="OriginalCharacter", character_id=uuid4(), owner_id=uuid4(),
                   body_kind="numen", body_id=uuid4(), body_owner_id=uuid4(), allowed_tools=["body:observe"],
                   persona="Fixture resident.", provider="tokenplan", model="fixture")
    cfg = {"endpoint": "http://127.0.0.1:5000/v1/hosted-role", "controlKeyFile": str(keyfile)}
    slot = {"bodyKind": "numen", "bodyId": str(role.body_id), "ownerGameId": str(role.native_owner_id), "numenAdmission": cfg}
    transport = {"name": "OriginalSlot", "endpoint": "http://127.0.0.1:5001/mcp"}
    validate_admission(slot, transport)
    with pytest.raises(ValueError):
        validate_admission(slot, {**transport, "endpoint": "http://other.example/mcp"})
    token_file = tmp_path / "role/hosted.token"
    issued, calls = [], []
    def bootstrap(req):
        envelope = json.loads(req.content)
        payload = envelope["payload"]
        assert str(req.url) == cfg["endpoint"] and "Authorization" not in req.headers
        assert hmac.compare_digest(base64.urlsafe_b64decode(envelope["signature"]+"="),
                                   hmac.new(key, payload.encode(), hashlib.sha256).digest())
        msg = json.loads(base64.urlsafe_b64decode(payload + "="*(-len(payload)%4)))
        assert (msg["name"],msg["ownerUuid"],msg["roleUuid"]) == ("OriginalSlot",str(role.native_owner_id),str(role.body_id))
        assert time.time()*1000 < msg["expires"] <= time.time()*1000+45000
        calls.append(msg["op"])
        result = {"roleUuid": str(role.body_id), "name": msg["name"], "ready": True}
        if msg["op"] == "session":
            issued.append(str(uuid4()))
            result.update(token=issued[-1],endpoint=transport["endpoint"])
        return httpx.Response(200,json=result)
    for _ in range(2):
        run(admit_numen(role,cfg,transport,token_file,http=httpx.MockTransport(bootstrap)))
        assert token_file.read_text() == issued[-1]
    assert calls == ["admit","session","admit","session"] and issued[0] != issued[1]
    for code in (403,409):
        with pytest.raises(httpx.HTTPStatusError):
            run(admit_numen(role,cfg,transport,token_file,http=httpx.MockTransport(lambda r, code=code: httpx.Response(code))))
        assert token_file.read_text() == issued[-1]


def test_disconnect_stops_only_current_run_and_new_transport_can_start(run):
    async def scenario():
        closed = []
        started = asyncio.Event()
        async def actor():
            started.set()
            try:
                await asyncio.Future()
            finally:
                closed.append(True)
        host = SimpleNamespace(body=SimpleNamespace(port=SimpleNamespace(disconnected=asyncio.Event())),run=actor)
        task = asyncio.create_task(run_with_connection(host))
        await started.wait()
        host.body.port.disconnected.set()
        with pytest.raises(ConnectionError):
            await task
        assert closed == [True]
        async def clean_shutdown():
            return "stopped"
        host.body.port.disconnected = asyncio.Event()
        host.run = clean_shutdown
        assert await run_with_connection(host) == "stopped"
    run(scenario())
