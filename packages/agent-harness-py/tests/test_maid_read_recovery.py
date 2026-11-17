"""Read failures never masquerade as uncertain item/movement writes."""
import asyncio
import json

import httpx
import pytest

from agent_mc_harness import BodyAction
from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.runtime import HarnessRuntime
from test_native_maid import MAID, NativeServer, make


class BrokenRead(NativeServer):
    fail = False
    malformed = False

    def __call__(self, request):
        payload = json.loads(request.content)
        if self.fail and payload.get("arguments", {}).get("action") in {"context", "inventory", "tasks"}:
            if self.malformed:
                response = super().__call__(request)
                body = response.json()
                body["result"]["content"][0]["text"] = "not a structured reply"
                return httpx.Response(200, json=body)
            return httpx.Response(500, json={"error": "synthetic read unavailable"})
        return super().__call__(request)


@pytest.mark.parametrize("verb,name", [("observe", None), ("inventory", None), ("native", "tasks")])
@pytest.mark.parametrize("malformed", [False, True])
def test_failed_read_is_terminal_and_next_valid_action_can_run(verb, name, malformed):
    async def run():
        server = BrokenRead()
        body = make(server)
        await body.spawn()
        try:
            server.fail, server.malformed = True, malformed
            receipt = await body.act(BodyAction(verb=verb, name=name, request_id="read-query-0001"))
            assert receipt.status == "failed" and receipt.terminal
            assert receipt.data["readOnly"] and receipt.data["effectsApplied"] is False
            assert not server.writes
            server.fail = False
            assert (await body.act(BodyAction(verb="observe", request_id="read-query-0002"))).status == "completed"
        finally:
            await body.destroy()
    asyncio.run(run())


@pytest.mark.parametrize("verb,name", [("observe", None), ("inventory", None), ("native", "tasks")])
def test_restart_settles_original_read_without_dispatch_or_fabricating_completion(tmp_path, verb, name):
    async def run():
        server = NativeServer()
        body = make(server)
        await body.spawn()
        journal = ActionJournal(tmp_path / "original.sqlite")
        action = BodyAction(verb=verb, name=name, request_id="old-read")
        journal.begin(MAID, action)
        journal.close()
        journal = ActionJournal(tmp_path / "original.sqlite")
        try:
            before = len(server.calls)
            restored, = journal.unresolved(MAID)
            body.restore_request(restored)
            result = await body.result(restored.request_id)
            assert result.request_id == "old-read" and result.status == "failed" and result.terminal
            assert result.data["effectsApplied"] is False
            journal.settle(MAID, result)
            assert not journal.unresolved(MAID) and len(server.calls) == before
            assert (await body.result("old-read")) == result
        finally:
            journal.close()
            await body.destroy()
    asyncio.run(run())


@pytest.mark.parametrize("action", [BodyAction(verb="move", args={"x": 1, "y": 65, "z": 2}),
                                    BodyAction(verb="native", name="brain", args={"choice": "dsh"})])
def test_restart_never_settles_or_replays_an_unknown_write(action):
    async def run():
        server = NativeServer()
        body = make(server)
        await body.spawn()
        try:
            original = action.model_copy(update={"request_id": "old-write"})
            body.restore_request(original)
            reply = await body.result("old-write")
            assert reply.status == "unknown" and not reply.terminal and not server.writes
            assert server.calls[-1]["arguments"]["action"] == "receipt"
            assert server.calls[-1]["arguments"]["operationId"] == "old-write"
        finally:
            await body.destroy()
    asyncio.run(run())


def test_harness_can_continue_after_a_failed_read_without_replaying_it(tmp_path):
    async def run():
        server = BrokenRead()
        body = make(server)
        await body.spawn()
        journal = ActionJournal(tmp_path / "runtime.sqlite")
        runtime = HarnessRuntime(body=body, execute=True, journal=journal)
        try:
            server.fail = True
            read = runtime.submit_intent("look", steps=[{"tool": "body:observe"}])
            await runtime.run_intent(read)
            assert read.state == "failed" and not journal.unresolved(MAID)
            server.fail = False
            follow = runtime.submit_intent("follow", steps=[{"tool": "body:follow"}])
            await runtime.run_intent(follow)
            assert follow.state == "completed" and len(server.writes) == 1
            assert server.writes[0]["action"] == "follow"
        finally:
            await runtime.close()
            journal.close()
            await body.destroy()
    asyncio.run(run())
