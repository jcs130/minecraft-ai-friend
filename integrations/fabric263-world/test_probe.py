import json
from pathlib import Path
import socket
import tempfile
import threading
import unittest

from prepare import write_json
from probe import execute


class ReconciliationTests(unittest.TestCase):
    def test_uncertain_execution_is_not_replayed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            client = root / "client"
            server = socket.socket()
            server.bind(("127.0.0.1", 0))
            server.listen()
            write_json(client / "graalweave" / "connection.json", {"host": "127.0.0.1", "port": server.getsockname()[1], "protocol": 1, "instance": str(client)})
            calls = []

            def consume():
                conn, _ = server.accept()
                with conn:
                    calls.append(json.loads(conn.makefile("rb").readline()))
                    conn.sendall(b'{"type":"started","id":"action-1"}\n')
                server.close()

            worker = threading.Thread(target=consume)
            worker.start()
            config = {"cache": str(root / "cache"), "client": str(client)}
            first = execute(config, "print('action')", "action-1")
            second = execute(config, "print('action')", "action-1")
            worker.join()
            self.assertEqual(first["status"], "unknown")
            self.assertTrue(second["deduplicated"])
            self.assertFalse(second["replayed"])
            self.assertEqual(len(calls), 1)
            with self.assertRaisesRegex(ValueError, "different operation"):
                execute(config, "print('different')", "action-1")

    def test_execution_done_does_not_claim_game_goal(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            client = root / "client"
            server = socket.socket()
            server.bind(("127.0.0.1", 0))
            server.listen()
            write_json(client / "graalweave" / "connection.json", {"host": "127.0.0.1", "port": server.getsockname()[1], "protocol": 1, "instance": str(client)})

            def consume():
                conn, _ = server.accept()
                with conn:
                    req = json.loads(conn.makefile("rb").readline())
                    conn.sendall(json.dumps({"type": "done", "id": req["id"], "status": "ok"}).encode() + b"\n")
                server.close()

            worker = threading.Thread(target=consume)
            worker.start()
            result = execute({"cache": str(root / "cache"), "client": str(client)}, "pass", "action-2")
            worker.join()
            self.assertEqual(result["status"], "ok")
            self.assertFalse(result["goalVerified"])


if __name__ == "__main__":
    unittest.main()
