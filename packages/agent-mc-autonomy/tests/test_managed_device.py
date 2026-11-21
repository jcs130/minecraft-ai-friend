import dataclasses
import json
import time

import pytest

from agent_mc_autonomy import controller, device_pairing, runner


def expiry():
    return int(time.time() * 1000) + 60000


def test_device_pairing_exposes_only_public_code_and_redeems_original_without_an_origin_change(monkeypatch, run_async):
    origin = "https://world.example.test"
    secret = "qdp_" + "p" * 43
    token = "qdh_" + "x" * 43
    replies = iter([{"pairId": "k" * 24, "pollSecret": secret, "expiresAt": expiry()},
                    {"state": "pending"},
                    {"state": "approved", "characterId": "original", "endpoint": origin + "/api/v1/character-device",
                     "token": token, "expiresAt": expiry()}])
    requests = []

    async def post(*args):
        requests.append(args)
        return next(replies)

    async def exercise():
        with pytest.raises(ValueError, match="https_portal"):
            await device_pairing.begin_device_pairing("http://world.example.test")
        pending = await device_pairing.begin_device_pairing(origin)
        assert secret not in repr(pending) and pending.approval_url == origin + "/resident-connect.html?flow=bodies"
        assert await device_pairing.redeem_device_pairing(pending) is None
        grant = await device_pairing.redeem_device_pairing(pending)
        assert token not in repr(grant)
        assert grant.client_binding() == {"characterId": "original", "endpoint": origin + "/api/v1/character-device"}
        assert grant.child_environment() == {"AGENT_MC_MANAGED_DEVICE_TOKEN": token}

    monkeypatch.setattr(device_pairing, "_post", post)
    run_async(exercise())
    assert requests == [(origin, {"op": "start"}), *[(origin, {"op":"redeem", "pairId":"k" * 24}, secret)] * 2]


@pytest.mark.parametrize("mode", ["headless", "server", "viewer"])
def test_runner_keeps_optional_pack_and_never_writes_the_grant_to_client_json(
        framework_module, tmp_path, monkeypatch, run_async, mode):
    token = "qdh_" + "r" * 43
    grant = device_pairing.ManagedPlayerDevice("original", "https://example.test/api/v1/character-device", expiry(), token)
    settings = dataclasses.replace(framework_module.Settings(), enabled=True, host="example.test",
                                   username="DeviceFixture", viewer_auto_open=False)
    if mode in {"server", "viewer"}:
        settings = dataclasses.replace(settings, server_engine_module="pinned-engine.mjs", server_engine_sha256="a" * 64)
    if mode == "viewer":
        settings = dataclasses.replace(settings, viewer_renderer_directory="pinned-viewer")

    class Controller:
        def __init__(self, *args, **kwargs):
            assert kwargs["managed_character"] == ("original", grant.expires_at)

        async def run(self, goal):
            assert goal == "fixture"

    def create(node, entry, config, log, *, env):
        raw = config.read_text()
        assert token not in raw
        assert env["AGENT_MC_MANAGED_DEVICE_TOKEN"] == token
        options = json.loads(raw)
        assert options["bodyHandoffDevice"]["characterId"] == "original"
        expected = {"headless":"device", "server":"server", "viewer":"viewer"}[mode]
        assert entry.name == expected + "-stdio.mjs"
        if mode == "server":
            assert options["serverEngineIntegration"]["module"] == "pinned-engine.mjs"
        if mode == "viewer":
            assert options["viewerIntegration"]["serverEngine"]["module"] == "pinned-engine.mjs"

    monkeypatch.setattr(runner, "Controller", Controller)
    run_async(runner.run_session(settings, tmp_path / "core" / "bin" / "fake.mjs", tmp_path, None, "fixture",
                                 lambda **_: None, lambda: False, bridge_factory=create, device_handoff=grant))


def sdk(data):
    return {"structuredContent": {"protocol":"agent-mc/v1", "data":data, "text":""}}


def connection(ready):
    return {"content":[{"type":"text","text":json.dumps({
        "phase":"started" if ready else "disconnected", "connection":{"ready":ready},
    })}]}


def test_managed_controller_waits_for_current_authority_and_the_original_receipt_without_reopening_socket(
        framework_module, tmp_path, monkeypatch, run_async):
    calls, statuses = [], []
    samples = iter([("numen", 2), ("maid", 3), ("mineflayer", 4)])
    receipts = iter(["switching", "recovery_required", "completed"])

    class Bridge:
        async def call(self, name, args, **kwargs):
            calls.append((name, args))
            if name == "mc_character_body" and args["action"] == "current":
                kind, generation = next(samples)
                return sdk({"characterId":"original", "activeKind":kind,"generation":generation,"status":"ready"})
            if name == "mc_character_body" and args == {"action":"lookup","requestId":"only-original"}:
                return sdk({"characterId":"original","requestId":"only-original","status":next(receipts)})
            if name == "mc_connection":
                return connection(True)  # The native acquiring adapter already connected the original body.
            pytest.fail("No gameplay, substitute request, or alternate body can be admitted")

    c = controller.Controller(Bridge(),None,framework_module.Settings(),tmp_path,
                              lambda **value: statuses.append(value),lambda: False,managed_character=("original",expiry()))
    c.managed_request = {"characterId":"original", "requestId":"only-original"}
    c.persist(managed_handoff=c.managed_request)

    async def no_delay(_):
        pass

    monkeypatch.setattr(controller.asyncio, "sleep", no_delay)
    assert run_async(c.await_managed_body())
    assert c.managed_generation == 4
    assert [row["phase"] for row in statuses] == ["waiting_for_body","waiting_for_body","running"]
    assert json.loads(c.state_path.read_text())["managed_handoff"] is None
    assert calls[-2:] == [("mc_connection", {"action":"status"}), ("mc_connection", {"action":"connect"})]
    assert all(args["requestId"] == "only-original" for name,args in calls if args["action"] == "lookup")
