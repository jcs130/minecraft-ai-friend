"""SDK-free subprocess acceptance with fake game/model and all network denied."""

import asyncio
import importlib.abc
import json
import socket
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path


class NoHosts(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, *_):
        if fullname.split(".")[0] in {"plugin", "cortico", "neko"}:
            raise AssertionError("Unexpected host dependency: " + fullname)


sys.meta_path.insert(0, NoHosts())
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))


def forbidden(*_, **__):
    raise AssertionError("Offline probe must not connect or launch a game/model")


def packed(value):
    return {"content": [{"type": "text", "text": json.dumps(value)}]}


async def probe(data, queue_only):
    from agent_mc_autonomy.configuration import Settings
    from agent_mc_autonomy.mailbox import Mailbox, observation
    from agent_mc_autonomy.runner import run_session

    settings = Settings(enabled=True, host="example.test", username="OfflineCheck", max_decisions=0,
                        min_decision_seconds=0, idle_decision_seconds=10)
    directory = data / "sessions" / settings.identity / "host"
    box = Mailbox(directory)
    request_id = str(uuid.uuid4())
    if queue_only:
        box.submit("steps", {"steps": [{"skill": "eat"}], "queue": "append"}, request_id)
    class Body:
        tools = [{"name": "mc_do", "inputSchema": {"type": "object", "properties": {"steps": {"type": "array", "items": {"type": "object"}}}}, "_meta": {"agent-mc/v1": {"tags": ["act"]}}}]
        def __init__(self):
            self.actions = []
            self.terminal_count = 0
        closed = False
        async def open(self):
            pass
        async def close(self):
            self.closed = True
        async def resource(self, _):
            return {"contents": [{"text": "Stable execution contract"}]}
        async def call(self, name, args, **metadata):
            if name == "mc_connection":
                return packed({"phase": "disconnected" if args["action"] == "disconnect" else "started",
                               "lamps": [{"label": "服务器", "state": "online"}]})
            if name == "mc_protocol":
                return packed({"parts": [{"key": "health", "text": "20"}]} if args["action"] == "facts" else {})
            if name == "mc_queue":
                return {"structuredContent": {"protocol": "agent-mc/v1", "text": "native queue", "execution": None}}
            if name == "mc_events":
                if len(self.actions) >= (1 if queue_only else 2):
                    box.submit("stop", {}, str(uuid.uuid4()))
                events = []
                if self.terminal_count < len(self.actions):
                    self.terminal_count += 1
                    events.append({"execution": {"kind": "task", "id": "native-" + str(self.terminal_count),
                                                 "phase": "completed", "terminal": True, "goalCompleted": False}})
                return packed({"run": "fake-run", "nextCursor": self.terminal_count, "events": events})
            if name == "mc_do":
                self.actions.append(metadata["request_id"])
                assert args["queue"] == "append"
                return {"structuredContent": {"protocol": "agent-mc/v1", "text": "accepted", "execution": {
                    "kind": "task", "id": "native-" + str(len(self.actions)), "phase": "accepted", "terminal": False, "goalCompleted": False}}}
            raise AssertionError(name)
    class FakeBrain:
        closed = False
        async def decide(self, messages, tools):
            assert messages[-1]["role"] == "user" and tools
            return {"content": None, "tool_calls": [{"type": "function", "id": "model-1",
                    "function": {"name": "mc_do", "arguments": '{"steps":[{"skill":"eat"}]}'}}]}
        async def aclose(self):
            self.closed = True
    body, brain = Body(), None if queue_only else FakeBrain()
    await run_session(settings, data / "fake.mjs", data, brain, "survive", lambda **_: None, lambda: False,
                      bridge_factory=lambda *_: body)
    assert len(body.actions) == (1 if queue_only else 2) and body.closed
    assert brain is None or brain.closed
    state = observation(directory)
    assert not state["game_connected"] and not state["live_verified"]
    assert json.loads((directory / "host-state.json").read_text())["pending"] == []
    if queue_only:
        assert body.actions == [request_id]
        assert box.get(request_id)["native_receipt"]["execution"]["id"] == "native-1"


with asyncio.Runner() as runner, tempfile.TemporaryDirectory() as temporary:
    runner.get_loop()  # Windows creates the internal loop socket pair here.
    socket.create_connection = socket.socket.connect = socket.socket.connect_ex = forbidden
    subprocess.Popen = forbidden
    from agent_mc_autonomy import cli as standalone
    assert standalone.main(["status", "--config", str(Path(__file__).resolve().parents[1] / "standalone.example.toml"),
                            "--data", str(Path(temporary) / "read-only")]) == 0
    assert not (Path(temporary) / "read-only").exists()
    runner.run(probe(Path(temporary) / "autonomous", False))
    runner.run(probe(Path(temporary) / "queue", True))
    assert not any(name.startswith("plugin.") for name in sys.modules)
print("no-host-imports; autonomous and queue-only cycles passed")
