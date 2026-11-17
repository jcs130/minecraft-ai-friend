"""Real Numen 0.1.5 interruption text must not become a failed/replayed attack."""
import asyncio

from mcp import types

from agent_mc_harness import BodyAction
from test_contract import make
from agent_mc_harness.body.native_tasks import NativeTasks, background_task, finished_tasks


BACKGROUND = ('The script stopped at line 1 (numen.fight.attack) after 2 calls: '
              'an urgent companion_hurt event arrived; t2 keeps running. Nothing after that ran.\n'
              '<runtime_state><current_task id="t2" tool="numen.fight.attack" state="running" '
              'standing="false" elapsed_s="2">ACTIVE</current_task></runtime_state>')


def test_background_attack_waits_for_exact_terminal_then_can_act_again(tmp_path, monkeypatch, run):
    async def go():
        async with make("numen-native", tmp_path, monkeypatch) as (body, world):
            original = world.call
            sent = []

            async def call(name, args):
                if name == "lua" and "fight.attack" in args.get("code", ""):
                    sent.append(args)
                    response = BACKGROUND if len(sent) == 1 else BACKGROUND.replace('t2', 't3')
                    return types.CallToolResult(isError=True, content=[types.TextContent(type="text", text=response)])
                return await original(name, args)

            world.call = call
            await body.spawn()
            try:
                action = BodyAction(verb="attack", args={"target": "hostile", "radius": 3}, request_id="req-combat-0001")
                receipt = await body.act(action)
                assert receipt.status == "accepted" and receipt.execution_id == "t2"
                assert (await body.act(action)).status == "accepted" and len(sent) == 1
                # Another task's completion is not evidence for this attack.
                world.events.append('<event kind="task_finished" id="t1" status="done">done</event>')
                await asyncio.sleep(.12)
                assert (await body.result(action.request_id)).status == "accepted"
                world.events.append('<event kind="task_finished" id="t2" status="done">enemy defeated</event>')
                for _ in range(40):
                    receipt = await body.result(action.request_id)
                    if receipt.terminal:
                        break
                    await asyncio.sleep(.05)
                assert receipt.status == "completed" and "enemy defeated" in receipt.text
                # Completed original ID remains idempotent, even after the controller ledger clears.
                assert (await body.act(action)).status == "completed" and len(sent) == 1
                another = action.model_copy(update={"request_id": "req-combat-0002"})
                assert (await body.act(another)).status == "accepted" and len(sent) == 2
                # A different connection's t2 cannot settle this action after reconnect.
                body.port.controller.connection_epoch = "different-session"
                world.events.append('<event kind="task_finished" id="t3" status="done">new task</event>')
                await asyncio.sleep(.15)
                assert (await body.result(another.request_id)).status == "unknown"
            finally:
                await body.destroy()
    run(go())


def test_native_task_receipt_survives_restart_and_never_binds_new_connection(tmp_path):
    path = tmp_path / 'native.sqlite3'
    ledger = NativeTasks(path, 'body-one')
    ledger.begin('request-one', 'fingerprint', 'connection-one')
    ledger.save('request-one', 'accepted', 'running', 't2')
    assert ledger.finish('connection-other', 't2', 'done', 'unrelated') == []
    ledger.close()
    ledger = NativeTasks(path, 'body-one')
    assert ledger.get('request-one', 'connection-two')['status'] == 'unknown'
    assert ledger.finish('connection-one', 't2', 'done', 'original task done') == ['fingerprint']
    ledger.close()
    ledger = NativeTasks(path, 'body-one')
    assert ledger.get('request-one', 'connection-two')['status'] == 'completed'
    ledger.close()


def test_native_server_markup_correlation_is_strict():
    assert background_task(BACKGROUND) == 't2'
    assert background_task(BACKGROUND.split('\n')[0]) == 't2'
    assert background_task(BACKGROUND.replace('id="t2"', 'id="t3"')) is None
    assert finished_tasks('<events><event kind="talk">&lt;event kind="task_finished" id="t2" status="done"/&gt;</event></events>') == []
    assert finished_tasks('<events><event kind="task_finished" id="t2" status="stopped">stopped</event></events>') == [('t2', 'stopped', 'stopped')]
