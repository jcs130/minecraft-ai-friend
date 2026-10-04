"""Target-port validation and refusal to replace an in-use server's bridge."""

from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

import build_society_bridge as build


class SocietyBridgePortTest(unittest.TestCase):
    def test_missing_properties_or_port_keeps_lab_default(self):
        with tempfile.TemporaryDirectory() as temporary:
            server = Path(temporary)
            self.assertEqual(build.server_port(server), build.PORT)
            (server / "server.properties").write_text("motd=lab\n#server-port=25565\n", encoding="utf-8")
            self.assertEqual(build.server_port(server), build.PORT)

    def test_reads_actual_target_28978_and_java_property_separators(self):
        with tempfile.TemporaryDirectory() as temporary:
            server = Path(temporary)
            for content in ("server-port=28978\n", " server-port = 28978 \n",
                            "server-port:28978\n", "server-port 28978\n",
                            "server-port=28976\n!server-port=1\nserver-port=28978\n"):
                with self.subTest(content=content):
                    (server / "server.properties").write_text(content, encoding="utf-8")
                    self.assertEqual(build.server_port(server), 28978)

    def test_invalid_values_fail_closed_instead_of_falling_back(self):
        with tempfile.TemporaryDirectory() as temporary:
            server = Path(temporary)
            for value in ("", "0", "-1", "65536", "28978.0", "+28978", "not-a-port", "２８９７８"):
                with self.subTest(value=value):
                    (server / "server.properties").write_text(f"server-port={value}\n", encoding="utf-8")
                    with self.assertRaisesRegex(ValueError, "server-port.*1..65535"):
                        build.server_port(server)
            (server / "server.properties").write_text("server-port\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                build.server_port(server)
            for value in (1, 65535):
                (server / "server.properties").write_text(f"server-port={value}\n", encoding="utf-8")
                self.assertEqual(build.server_port(server), value)

    def test_guard_binds_configured_port_not_old_fixed_port(self):
        with tempfile.TemporaryDirectory() as temporary:
            server = Path(temporary)
            (server / "server.properties").write_text("server-port=28978\n", encoding="utf-8")
            with patch.object(build.socket, "socket") as factory:
                self.assertEqual(build.ensure_server_stopped(server), 28978)
                factory.return_value.__enter__.return_value.bind.assert_called_once_with(("0.0.0.0", 28978))

    def test_occupied_local_test_port_blocks_install_and_keeps_both_files(self):
        # Only a bound socket on an OS-chosen private test port: no connection,
        # listener, Minecraft process, or production directory is involved.
        with tempfile.TemporaryDirectory() as temporary, socket.socket() as held:
            server = Path(temporary)
            if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                held.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            held.bind(("127.0.0.1", 0))
            port = held.getsockname()[1]
            (server / "server.properties").write_text(f"server-port={port}\n", encoding="utf-8")
            candidate = server / "candidate.jar"
            target = server / "installed.jar"
            candidate.write_bytes(b"new jar")
            target.write_bytes(b"old jar")
            with self.assertRaisesRegex(RuntimeError, f"TCP port {port}.*occupied"):
                build.install_candidate(candidate, target, server)
            self.assertEqual(candidate.read_bytes(), b"new jar")
            self.assertEqual(target.read_bytes(), b"old jar")

    def test_install_rechecks_after_configuration_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            server = Path(temporary)
            properties = server / "server.properties"
            properties.write_text("server-port=28976\n", encoding="utf-8")
            with patch.object(build.socket, "socket") as factory:
                build.ensure_server_stopped(server)
                factory.return_value.__enter__.return_value.bind.assert_called_once_with(("0.0.0.0", 28976))
            properties.write_text("server-port=28978\n", encoding="utf-8")
            with patch.object(build.socket, "socket") as factory, patch.object(build.os, "replace") as replace:
                probe = factory.return_value.__enter__.return_value
                probe.bind.side_effect = OSError("now occupied")
                with self.assertRaisesRegex(RuntimeError, "28978.*occupied"):
                    build.install_candidate(server / "candidate.jar", server / "target.jar", server)
                probe.bind.assert_called_once_with(("0.0.0.0", 28978))
                replace.assert_not_called()


if __name__ == "__main__":
    unittest.main()
