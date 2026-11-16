"""Run three real TLM jobs on a fresh stock NeoForge world with Qwen Code."""
from __future__ import annotations

import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen


spec = importlib.util.spec_from_file_location("stock_stage", Path(__file__).with_name("stock-stage.py"))
stock = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stock)

IDS = [f"10000000-0000-0000-0000-00000000001{i}" for i in (1, 2, 3)]
OWNERS = [f"20000000-0000-0000-0000-00000000002{i}" for i in (1, 2, 3)]
ROLES = ("禾穗", "绒铃", "灯守")
TASKS = ("farm", "shears", "attack")
MODEL = "qa-flash"


def model_relay(token, upstream_key, alias, calls):
    class Relay(BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path != "/v1/chat/completions" or self.headers.get("Authorization") != f"Bearer {token}":
                self.send_error(403)
                return
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            assert payload["model"] == MODEL and payload.get("stream") is True and not payload.get("tools"), (
                "Qwen Code must make a single plan without host tools"
            )
            index = [i for i, name in enumerate(ROLES) if name in json.dumps(payload["messages"], ensure_ascii=False)]
            entry = {"role": ROLES[index[0]] if len(index) == 1 else None}
            calls.append(entry)
            payload["model"] = alias
            # Dedicated NPC test route. Shared LiteLLM presets are untouched.
            payload.pop("reasoning_effort", None)
            payload.pop("thinking_budget", None)
            payload.pop("max_completion_tokens", None)
            payload["enable_thinking"] = False
            payload["max_tokens"] = 320
            payload["stream_options"] = {**(payload.get("stream_options") or {}), "include_usage": True}
            request = Request("http://127.0.0.1:4000/v1/chat/completions",
                data=json.dumps(payload).encode(), headers={"Authorization": f"Bearer {upstream_key}",
                "Content-Type": "application/json"})
            try:
                with urlopen(request, timeout=25) as upstream:
                    assert upstream.geturl() == request.full_url
                    body = upstream.read(512 * 1024 + 1)
                    assert len(body) <= 512 * 1024
                    entry["http"] = upstream.status
            except HTTPError as error:
                entry["http"] = error.code
                self.send_error(502)
                return
            data_lines = [line.removeprefix(b"data:").strip() for line in body.splitlines()
                          if line.startswith(b"data:")]
            events = [json.loads(line) for line in data_lines if line.startswith(b"{")]
            entry["usage"] = next((event["usage"] for event in reversed(events) if event.get("usage")), None)
            entry["promptChars"] = sum(len(str(message.get("content", ""))) for message in payload["messages"])
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    return ThreadingHTTPServer(("127.0.0.1", 0), Relay)


def capsule(stage, port, tokens):
    sites, maids, gate = {}, [], []
    for i, (maid, owner, token) in enumerate(zip(IDS, OWNERS, tokens, strict=True)):
        site = f"maidagent_qwen_{TASKS[i]}"
        sites[site] = {"id": site, "api_type": "openai", "enabled": True,
            "icon": "touhou_little_maid:textures/gui/ai_chat/openai.png",
            "url": f"http://127.0.0.1:{port}/v1/{maid}/qwen/chat/completions",
            "secret_key": token, "headers": {}, "models": [MODEL]}
        maids.append({"maidId": maid, "ownerId": owner, "choices": {"qwen": {"site": site, "model": MODEL}}})
        gate.append({"maidId": maid, "ownerId": owner, "token": token, "choices": {"qwen": {
            "harness_id": "qwen-code", "model": MODEL, "cliModel": f"lab/{MODEL}",
            "allowedTools": ["switch_work_task"]}}})
    stock.data(stage / "config/tlm-maid-agents.json", {"schema": 1, "maids": maids})
    stock.data(stage / "config/touhou_little_maid/sites/llm.json", sites)
    return gate


def exercise(args):
    stage = args.server.resolve()
    if (stage / ".standalone-maid-agents-lab").read_text().strip() != "SYNTHETIC_STOCK_NEOFORGE":
        raise ValueError("use_marked_stock_neoforge_fixture")
    stock_jar = hashlib.sha256(args.maid.read_bytes()).hexdigest()
    assert stock_jar == "f6db04195820c8508704277ea76d63723804ff236a7b780369ba59ebe5cd9c27"
    run_id = secrets.token_hex(4)
    phase = stage / f"qwen-exercise-{run_id}"
    phase.mkdir()
    (stage / "mods").mkdir(exist_ok=True)
    shutil.copyfile(args.maid, stage / "mods" / args.maid.name)
    shutil.copyfile(args.addon, stage / "mods/tlm-maid-agents.jar")
    stock.make_probe(phase, stage, args.java, args.maid, Path(__file__).with_name("QwenMaidProbe.java"))
    win_args, = stage.glob("libraries/net/neoforged/neoforge/21.1.*/win_args.txt")
    game_port, rcon_port, gateway_port = stock.ports()
    password = secrets.token_hex(20)
    (stage / "server.properties").write_text(
        f"server-ip=127.0.0.1\nserver-port={game_port}\nenable-rcon=true\nrcon.port={rcon_port}\nrcon.password={password}\n"
        f"level-name=qwen-maids-{run_id}\nlevel-type=minecraft:flat\ngamemode=creative\nspawn-protection=0\n"
        "difficulty=easy\nview-distance=3\nsimulation-distance=3\nmax-players=2\nonline-mode=false\n"
        'generator-settings={"layers":[{"block":"minecraft:bedrock","height":1},{"block":"minecraft:dirt","height":2},'
        '{"block":"minecraft:grass_block","height":1}],"biome":"minecraft:plains"}\n', encoding="ascii")
    (stage / "eula.txt").write_text("eula=true\n", encoding="ascii")

    tokens = [secrets.token_hex(24) for _ in IDS]
    rows = capsule(stage, gateway_port, tokens)
    calls = []
    relay_token = secrets.token_hex(24)
    upstream_key = os.environ["QD_MAID_QA_MODEL_KEY"]
    with stock.serving(model_relay(relay_token, upstream_key, args.model, calls)) as relay:
        qwen_dir = phase / "qwen-config"
        stock.data(qwen_dir / "settings.json", {"providers": {"lab": {
            "type": "openai-compatible", "protocol": "openai", "baseUrl": f"http://127.0.0.1:{relay.server_port}/v1",
            "apiKey": relay_token, "models": [{"model": MODEL}]}}, "telemetry": {"enabled": False}})
        config = {"schema": 1, "host": "127.0.0.1", "port": gateway_port, "timeoutSeconds": 35,
            "maxConcurrent": 3, "qwenCode": {"executable": str(args.qwen.resolve()), "configDir": str(qwen_dir)},
            "maids": rows}
        with stock.serving(stock.create_server(config)):
            request = Request(f"http://127.0.0.1:{gateway_port}/v1/{IDS[1]}/qwen/chat/completions",
                              data=b"{}", headers={"Authorization": f"Bearer {tokens[0]}"})
            try:
                with urlopen(request, timeout=3):
                    raise AssertionError("wrong NPC token accepted")
            except HTTPError as error:
                assert error.code == 401 and not calls
            result = run_world(args, stage, phase, win_args, rcon_port, password, calls)
    result.update(minecraft="1.21.1", tlmSha256=stock_jar, launcher="Qwen Code 1.0.0-preview.1", model=args.model)
    stock.data(args.report, result)
    print(json.dumps(result, ensure_ascii=False), flush=True)


def run_world(args, stage, phase, win_args, port, password, calls):
    def cmd(text):
        return stock.rcon(port, password, text)

    def observe():
        return json.loads(cmd("qwenmaidtest check").strip())

    with (phase / "server.log").open("wb") as log:
        server = subprocess.Popen([str(args.java), "-Xms512m", "-Xmx1400m", "-XX:ActiveProcessorCount=3",
                                   "@" + win_args.relative_to(stage).as_posix(), "nogui"],
            cwd=stage, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            stock.until(lambda: "players online" in cmd("list"), 145)
            cmd("gamerule doMobSpawning false")
            cmd("gamerule randomTickSpeed 0")
            cmd("forceload add 0 0 112 16")
            assert "seeded" in cmd("qwenmaidtest seed")

            def loaded():
                state = cmd("maidagent list")
                return all(maid + " loaded" in state for maid in IDS)

            stock.until(loaded, 12)
            for maid in IDS:
                assert "brain=qwen" in (selected := cmd(f"maidagent brain {maid} qwen")), selected
                assert "mode=home" in (placed := cmd(f"maidagent mode {maid} home")), placed
            before = observe()
            assert all(before[role]["task"].endswith(":idle") for role in ROLES)
            assert [before[role]["homeX"] for role in ROLES] == [8, 48, 88], before
            assert "assigned" in cmd("qwenmaidtest assign")

            def assigned():
                status = observe()
                return status if all(status[role]["task"].endswith(":" + task) and status[role]["history"] >= 2
                    for role, task in zip(ROLES, TASKS, strict=True)) else None

            try:
                decision = stock.until(assigned, 65)
            except AssertionError:
                raise AssertionError(f"Qwen duties not applied: {observe()}; requests={calls}") from None
            stock.until(lambda: len(calls) >= 6 and all("usage" in row for row in calls), 40)
            assert all(row.get("http") == 200 and row.get("role") in ROLES and row.get("usage") for row in calls), calls
            assert all(row["usage"]["completion_tokens"] <= 320
                       and (row["usage"].get("completion_tokens_details") or {}).get("reasoning_tokens", 0) == 0
                       for row in calls), calls
            charged = len(calls)
            assert charged == 6, calls
            assert decision["onlinePlayers"] == 0
            print(f"Qwen Code configured three original work modes in {charged} actual model requests", flush=True)

            def done(previous):
                state = observe()
                harvest = state[ROLES[0]]["inventory"] > previous[ROLES[0]]["inventory"]
                finished = state["matureCrops"] < 3 and harvest and state["sheared"] and state["huskHealth"] == 0
                return state if finished else None

            began = time.monotonic()
            rounds = []
            previous = decision
            for _ in range(2):
                assert "stocked" in cmd("qwenmaidtest work")
                try:
                    work = stock.until(lambda: done(previous), 65)
                except AssertionError:
                    raise AssertionError(f"Native work incomplete: {observe()}; requests={calls}") from None
                assert work["onlinePlayers"] == 0 and charged == len(calls)
                rounds.append(work)
                previous = work
            return {"choices": decision, "work": rounds, "idleModelRequests": len(calls) - charged,
                "observedWorkSeconds": round(time.monotonic() - began, 2), "modelCalls": calls}
        finally:
            if server.poll() is None:
                try:
                    cmd("stop")
                    server.wait(timeout=45)
                except (OSError, subprocess.TimeoutExpired):
                    server.terminate()  # Only this test's locally created server.
                    server.wait(timeout=10)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("server", "maid", "addon", "java", "qwen", "report"):
        parser.add_argument("--" + field, type=Path, required=True)
    parser.add_argument("--model", default="tokenplan/qwen3.8-flash")
    exercise(parser.parse_args())
