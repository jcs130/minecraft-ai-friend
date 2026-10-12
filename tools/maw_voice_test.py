import pathlib
import socket
import struct
import tempfile
import threading
import unittest

import maw_voice as voice


class VoiceHealthTest(unittest.TestCase):
    def exchange(self, reply):
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as server:
            server.bind(("127.0.0.1", 0)); server.settimeout(2)
            endpoint = server.getsockname()
            def run():
                request, remote = server.recvfrom(512)
                self.request = request
                server.sendto(reply(request), remote)
            worker = threading.Thread(target=run)
            worker.start()
            try:
                return voice.udp_probe(*endpoint, timeout=.5)
            finally:
                worker.join(2)

    def test_original_ping_and_positive_echo(self):
        value = self.exchange(lambda request: request[-24:])
        self.assertEqual(value["protocol"], "svc-ping-v1")
        self.assertEqual(self.request[:18], b"\xff" + voice.PING_V1 + b"\x18")
        self.assertEqual(len(self.request), 42)
        self.assertGreater(struct.unpack(">q", self.request[-8:])[0], 0)

    def test_unrelated_echo_is_not_ready(self):
        with self.assertRaisesRegex(ValueError, "challenge"):
            self.exchange(lambda request: b"x" * 24)

    def test_closed_port_is_not_ready(self):
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as endpoint:
            endpoint.bind(("127.0.0.1", 0)); port = endpoint.getsockname()[1]
        with self.assertRaises(OSError):
            voice.udp_probe("127.0.0.1", port, .1)

    def test_optional_client_and_fixed_lan_config(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            path = root / "config/voicechat/voicechat-server.properties"
            path.parent.mkdir(parents=True)
            path.write_text(voice.render_config(), encoding="utf-8")
            self.assertFalse(voice.validate(root, check_jar=False)["clientRequiredForGame"])
            for old, new in (("force_voice_chat=false", "force_voice_chat=true"),
                    ("bind_address=192.168.3.163", "bind_address=*"),
                    ("enable_groups=false", "enable_groups=true")):
                path.write_text(voice.render_config().replace(old, new), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "configuration changed"):
                    voice.validate(root, check_jar=False)

    def test_wrong_artifact_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory); (root / "mods").mkdir()
            (root / "mods" / voice.NAME).write_bytes(b"wrong JAR")
            path = root / "config/voicechat/voicechat-server.properties"; path.parent.mkdir(parents=True)
            path.write_text(voice.render_config(), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "locked stable"):
                voice.validate(root)

    def test_research_and_production_endpoints_not_interchangeable(self):
        self.assertEqual(voice.settings("127.0.0.1", 28980)["voice_host"], "127.0.0.1:28980")
        for endpoint in (("0.0.0.0", voice.PORT), (voice.HOST, 24454), ("127.0.0.1", voice.PORT)):
            with self.assertRaises(ValueError):
                voice.settings(*endpoint)


if __name__ == "__main__":
    unittest.main()
