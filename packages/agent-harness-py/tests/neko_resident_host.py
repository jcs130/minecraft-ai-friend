"""Run with the upstream N.E.K.O. virtualenv: python neko_resident_host.py PATH_TO_NEKO."""
import asyncio
import json
import logging
import os
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from zipfile import ZipFile


def port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


async def run_test(root, neko):
    main_port, plugin_port = port(), port()
    origin = f"http://127.0.0.1:{main_port}"
    os.environ.update(NEKO_STORAGE_SELECTED_ROOT=str(root), NEKO_STORAGE_ANCHOR_ROOT=str(root),
                      NEKO_MAIN_SERVER_PORT=str(main_port), NEKO_USER_PLUGIN_SERVER_PORT=str(plugin_port),
                      NEKO_PLUGIN_ZMQ_IPC_ENDPOINT=f"tcp://127.0.0.1:{port()}", PYTHONUTF8="1")
    sys.path.insert(0, str(neko))
    os.chdir(neko)
    from fastapi import FastAPI, HTTPException, Request
    import httpx
    import uvicorn
    from plugin.core.host import PluginHost
    from plugin.core.state import state
    from plugin.server.messaging.llm_tool_registry import shutdown_http_client
    from plugin.server.routes.llm_tools import router

    src = Path(__file__).resolve().parents[1] / "integrations/neko_resident"
    sys.path.insert(0, str(src.parent))
    from pack_neko_resident import package
    artifact = root / "resident.neko-plugin"
    package(neko, src, artifact)
    dest = root / "plugins/neko_resident"
    with ZipFile(artifact) as archive:
        assert archive.testzip() is None
        for file in ("__init__.py", "connection.py", "pyproject.toml", "plugin.toml", "ui/panel.tsx", "LICENSE"):
            content = archive.read("payload/plugins/neko_resident/" + file)
            original = src.parents[3] / file if file == "LICENSE" else src / file
            assert content.decode() == original.read_text(encoding="utf-8")
            (dest / file).parent.mkdir(parents=True, exist_ok=True)
            (dest / file).write_bytes(content)
    with (dest / "plugin.toml").open("a", encoding="utf-8") as cfg:
        cfg.write(f'\nportal_origin = "{origin}"\n')

    api, plugins, incoming, registry = FastAPI(), FastAPI(), asyncio.Queue(), {}
    plugins.include_router(router)
    resident = {"id": "resident-qa", "bodyKind": "numen", "name": "桐人", "characterId": str(uuid.uuid4()), "state": "available"}
    maid = {"id": "resident-maid", "bodyKind": "maid", "name": "清夏", "characterId": str(uuid.uuid4()), "state": "preparing"}
    endpoint = "/api/v1/resident-turns/resident-qa"
    code = "FFFF-2222-GGGG"
    secret = "rdt_" + "k" * 43
    turn = None
    replies = []
    new_code = "BBBB-9999-YYYY"
    onboard = "rot_" + "n" * 43
    create_ids = set()

    @api.get("/api/characters")
    async def characters():
        return {"猫娘": {"桐人桌面": {}, "空": {}}, "当前猫娘": "桐人桌面"}

    @api.post("/api/v1/resident-onboarding/{operation}")
    async def onboarding(operation: str, payload: dict, request: Request):
        if operation == "pair":
            if payload.get("code") != new_code:
                raise HTTPException(403)
            return {"onboardingToken": onboard, "expiresAt": time.time() * 1000 + 60000}
        assert request.headers["Authorization"] == "Bearer " + onboard
        if operation == "list":
            return {"residents": [resident, maid] if create_ids else [resident], "availableBodies": [] if create_ids else ["maid"]}
        if operation == "create":
            assert (payload["name"], payload["bodyKind"], payload["persona"]) == ("清夏", "maid", "营地管理员")
            create_ids.add(payload["requestId"])
            return {"resident": maid}
        target = next(row for row in (resident, maid) if row["id"] == payload["id"])
        assert operation == "connect" and payload["characterId"] == target["characterId"] and target["state"] == "available"
        return {"endpoint": origin + endpoint.replace(resident["id"], target["id"]), "token": secret, "resident": target}

    @api.post("/api/v1/resident-turns/pair")
    async def pair(payload: dict, request: Request):
        assert not request.headers.get("Authorization") and payload == {"code": code}
        return {"endpoint": origin + endpoint, "token": secret, "resident": resident}

    @api.post(endpoint + "/{operation}")
    async def exchange(operation: str, payload: dict, request: Request):
        nonlocal turn
        assert request.headers["Authorization"] == "Bearer " + secret
        if operation == "begin":
            assert payload == {}
            return {"state": "requested", "requestId": "test-wakeup"}
        if operation == "poll":
            assert payload == {}
            return {"turn": turn}
        assert operation == "reply"
        replies.append(payload)
        turn = None
        return {"accepted": True}

    @api.post("/api/tools/register")
    async def register(data: dict):
        assert data["role"] == "桐人桌面" and data["source"] == "plugin:neko_resident"
        registry[data["name"]] = data
        return {"ok": True, "roles": ["桐人桌面"]}

    @api.post("/api/tools/unregister")
    async def unregister(data: dict):
        registry.pop(data["name"], None)
        return {"ok": True, "removed": True}

    def new_host():
        obj = PluginHost("neko_resident", "plugin.plugins.neko_resident:ResidentPlugin", dest / "plugin.toml", source_only=True)
        with state.acquire_plugin_hosts_write_lock():
            state.plugin_hosts["neko_resident"] = obj
        return obj

    async def callback(client, name, **args):
        resp = await client.post(registry["qd_resident_" + name]["callback_url"], json={
            "name": "qd_resident_" + name, "arguments": args, "raw_arguments": json.dumps(args), "call_id": uuid.uuid4().hex})
        resp.raise_for_status()
        result = resp.json()
        assert not result.get("is_error"), result
        return result["output"]

    async def packet_for(id):
        async with asyncio.timeout(12):
            while True:
                packet = await incoming.get()
                parts = packet.get("parts") or []
                if parts and id in parts[0].get("text", ""):
                    assert packet["target_lanlan"] == "桐人桌面" and packet["visibility"] == []
                    assert packet["ai_behavior"] == "respond"
                    return json.loads(parts[0]["text"].split("\n", 1)[1])

    host, servers = new_host(), []
    try:
        for app, number in ((api, main_port), (plugins, plugin_port)):
            server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=number, access_log=False, log_level="warning"))
            servers.append((server, asyncio.create_task(server.serve())))
            while not server.started:
                await asyncio.sleep(.05)
        await host.start(message_target_queue=incoming, startup_timeout=25, startup_failure="raise")
        panel = await host.get_ui_context("resident_connection")
        panel_token = panel["state"]["uiToken"]
        assert panel_token and not panel["state"]["connected"] and panel["state"]["role"] == "桐人桌面"
        assert {"open_resident_website", "pair_resident"}.issubset({a["id"] for a in panel["actions"]})
        await host.trigger("pair_resident", {"code": new_code, "uiToken": panel_token})
        panel = (await host.get_ui_context("resident_connection"))["state"]
        assert panel["authorized"] and not panel["connected"] and onboard not in str(panel)
        assert panel["catalog"]["availableBodies"] == ["maid"] and panel["localRoles"] == ["桐人桌面", "空"]
        await host.trigger("manage_residents", {"op": "connect", "id": resident["id"], "characterId": resident["characterId"], "uiToken": panel_token})
        async with asyncio.timeout(12):
            while len(registry) < 5:
                await asyncio.sleep(.05)
        panel = (await host.get_ui_context("resident_connection"))["state"]
        assert (panel["connected"], panel["role"], panel["resident"]) == (True, "桐人桌面", "桐人")
        assert code not in str(panel) and secret not in str(panel)
        async with httpx.AsyncClient(trust_env=False) as client:
            assert (await callback(client, "begin"))["requestId"] == "test-wakeup"
            msg = {"id": "voice-42", "medium": "voice", "scope": "nearby", "speakerName": "灵梦", "text": "能听见吗？"}
            route = {"mode": "speech", "scope": "nearby", "sourceEventId": msg["id"]}
            turn = {"id": "qa-voice", "until": int(time.time() * 1000) + 20000, "resident": resident, "kind": "dialogue",
                    "scene": {"communication": {"version": 1, "messages": [msg], "outputs": [route]}}}
            assert (await packet_for("qa-voice"))["scene"]["communication"]["messages"] == [msg]
            desc = await callback(client, "capabilities", id="qa-voice")
            assert desc["communication"]["outputs"] == [route]
            for bad in ({"sourceEventId": "other"}, {"scope": "public"}, {"mode": "text"}, {"id": "expired"}):
                args = {"id": "qa-voice", "text": "听见了。", **route, **bad}
                assert not (await callback(client, "communicate", **args))["accepted"]
            assert not replies
            assert (await callback(client, "communicate", id="qa-voice", text="听见了。", **route))["accepted"]
            assert replies == [{"id": "qa-voice", "answer": {"communication": {
                "mode": "speech", "text": "听见了。", "sourceEventId": "voice-42"}}}]
            tools = [{"tool": "body:observe", "parameters": {"type": "object"}}]
            turn = {"id": "qa-plan", "until": int(time.time() * 1000) + 20000, "resident": resident, "kind": "plan",
                    "scene": {"bodyTools": tools}}
            await packet_for("qa-plan")
            assert (await callback(client, "capabilities", id="qa-plan", tool="body:observe"))["bodyTools"] == tools
            assert not (await callback(client, "body_action", id="qa-plan", tool="body:other", arguments={}))["accepted"]
            assert (await callback(client, "body_action", id="qa-plan", tool="body:observe", arguments={}))["accepted"]
            assert replies[-1] == {"id": "qa-plan", "answer": {"steps": [{"tool": "body:observe", "args": {}}]}}
        await host.shutdown(timeout=12)
        host = new_host()
        await host.start(message_target_queue=incoming, startup_timeout=25, startup_failure="raise")
        state_after_restart = (await host.get_ui_context("resident_connection"))["state"]
        assert state_after_restart["connected"] and state_after_restart["role"] == "桐人桌面"
        panel_token = state_after_restart["uiToken"]
        await host.trigger("pair_resident", {"code": new_code, "uiToken": panel_token})
        payload = {"op": "create", "name": "清夏", "bodyKind": "maid", "persona": "营地管理员", "uiToken": panel_token}
        await host.trigger("manage_residents", payload)
        await host.trigger("manage_residents", payload)
        assert len(create_ids) == 1
        assert (await host.get_ui_context("resident_connection"))["state"]["waiting"] == "清夏"
        maid["state"] = "available"
        await host.trigger("manage_residents", {"op": "list", "uiToken": panel_token})
        assert (await host.get_ui_context("resident_connection"))["state"]["resident"] == "清夏"
        await host.trigger("pair_resident", {"code": code, "uiToken": panel_token})
        assert (await host.get_ui_context("resident_connection"))["state"]["resident"] == "桐人"
        print("PASS packaged Hosted UI, current role discovery, official grant, select/create and legacy pairing, persistent role, speech and begin.")
    finally:
        await host.shutdown(timeout=12)
        await shutdown_http_client()
        for server, _task in servers:
            server.should_exit = True
        await asyncio.gather(*(task for _, task in servers))


if __name__ == "__main__":
    if len(sys.argv) == 3:
        try:
            asyncio.run(run_test(Path(sys.argv[2]), Path(sys.argv[1]).resolve()))
        finally:
            logging.shutdown()
    else:
        # The upstream host owns process-lifetime file loggers on Windows.
        with tempfile.TemporaryDirectory(prefix="qd-neko-resident-") as temp:
            subprocess.run([sys.executable, __file__, str(Path(sys.argv[1]).resolve()), temp], check=True)
