"""Run with Python unittest; no Project N.E.K.O. service/model required."""
import asyncio
import json
import unittest
from native_mod import NativeModRequests

ACTOR = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"


class Socket:
    def __init__(self):
        self.sent = []

    async def send(self, wire):
        self.sent.append(json.loads(wire))


def reply(message, **fields):
    return {"type": "native_mod_result", "schemaVersion": 1,
            "requestId": message["requestId"], "action": message["action"],
            "id": message["id"], "callId": message["callId"], "playerUuid": ACTOR, "ok": True, **fields}


class NativeRequestsTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = NativeModRequests()
        self.socket = Socket()
        self.client.connected(self.socket)

    async def test_structured_args_complete_components_and_private_receipt(self):
        args = {"inventorySlot": 1, "expectedSnbt": '{id:"ars_nouveau:book",components:{name:"法术书"}}'}
        task = asyncio.create_task(self.client.request(self.socket, operation="call", id="spell.configure", args=args))
        await asyncio.sleep(0)
        message = self.socket.sent[0]
        self.assertEqual(message["args"], args)
        self.assertIsInstance(message["callId"], str)
        self.client.receive(self.socket, reply(message, result={"ok": True, "args": args}))
        result = await task
        self.assertEqual(result["result"]["args"], args)
        self.assertEqual(self.client.pending, {})

    async def test_wrong_id_action_account_and_old_socket_ignored(self):
        self.client.player_uuid = ACTOR
        task = asyncio.create_task(self.client.request(self.socket, operation="call", id="curios.open", callId="open"))
        await asyncio.sleep(0)
        message = self.socket.sent[0]
        for fields in ({"requestId": "other"}, {"action": "list"}, {"id": "spell.cast"},
                       {"callId": "other"}, {"playerUuid": OTHER}, {"playerUuid": None}):
            self.client.receive(self.socket, reply(message, **fields))
            self.assertFalse(task.done())
        self.client.receive(Socket(), reply(message))
        self.assertFalse(task.done())
        self.client.receive(self.socket, reply(message))
        self.assertTrue((await task)["ok"])

    async def test_disconnect_returns_unknown_and_reconnect_does_not_resend(self):
        task = asyncio.create_task(self.client.request(self.socket, operation="call", id="curios.open", callId="original"))
        await asyncio.sleep(0)
        self.client.disconnected(self.socket)
        result = await task
        self.assertTrue(result["outcomeUnknown"])
        self.assertEqual(result["callId"], "original")
        other_socket = Socket()
        self.client.connected(other_socket)
        self.assertEqual(other_socket.sent, [])
        self.assertEqual(len(self.socket.sent), 1)

    async def test_timeout_late_receipt_never_fulfils_new_request(self):
        result = await self.client.request(self.socket, operation="call", id="curios.open", callId="late", timeout=0.001)
        self.assertTrue(result["outcomeUnknown"])
        old = self.socket.sent[0]
        task = asyncio.create_task(self.client.request(self.socket, operation="status"))
        await asyncio.sleep(0)
        self.client.receive(self.socket, reply(old))
        self.assertFalse(task.done())
        self.client.receive(self.socket, reply(self.socket.sent[1]))
        self.assertTrue((await task)["ok"])

    async def test_validation_prevents_send(self):
        for params in ({"operation": "invalid"}, {"operation": "call"}, {"operation": "result"},
                       {"operation": "call", "id": "a", "args": []},
                       {"operation": "call", "id": "a", "args": {"x": float("nan")}}):
            self.assertFalse((await self.client.request(self.socket, **params))["ok"])
        self.assertEqual(self.socket.sent, [])

    async def test_unknown_requires_read_only_receipt_reconciliation_before_new_call(self):
        result = await self.client.request(self.socket, operation="call", id="curios.open", callId="unknown", timeout=0.001)
        self.assertTrue(result["outcomeUnknown"])
        blocked = await self.client.request(self.socket, operation="call", id="curios.open", callId="new")
        self.assertEqual(blocked["code"], "native_receipt_reconciliation_required")
        self.assertEqual(len(self.socket.sent), 1)
        task = asyncio.create_task(self.client.request(self.socket, operation="result", callId="unknown"))
        await asyncio.sleep(0)
        self.client.receive(self.socket, reply(self.socket.sent[-1], outcomeUnknown=False, result={"ok": True}))
        self.assertTrue((await task)["ok"])
        self.assertEqual(self.client.uncertain_calls, set())

    async def test_malformed_receipt_identifier_does_not_break_listener(self):
        self.assertTrue(self.client.receive(self.socket, {"type": "native_mod_result", "requestId": []}))


if __name__ == "__main__":
    unittest.main()
