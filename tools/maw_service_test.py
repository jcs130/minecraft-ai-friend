"""Isolated supervisor safety tests; never start/connect a Minecraft server."""
from __future__ import annotations

import copy
import base64
import ctypes
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

import maw_service as service


def sharing_error(code=32, error_type=PermissionError):
    # OSError(errno.EACCES) is promoted to PermissionError by Python; keep
    # the generic OSError fixture distinct when testing the WinError 5 guard.
    error = error_type(5 if error_type is OSError else 13, "fixture Windows sharing conflict")
    error.winerror = code
    return error


class AtomicJsonTests(unittest.TestCase):
    def test_transient_windows_conflict_retries_same_file_and_original_payload(self):
        for code in (32, 33, 5):
            with self.subTest(winerror=code), tempfile.TemporaryDirectory() as tmp:
                target = Path(tmp) / "health.json"
                target.write_text('{"old":true}', encoding="utf-8")
                payload = {"healthy": True, "count": 1}
                real_replace, observed = os.replace, []
                def replace(source, destination):
                    observed.append((source, destination, source.read_bytes()))
                    if len(observed) == 1:
                        payload["count"] = 99
                        raise sharing_error(code)
                    return real_replace(source, destination)
                with patch.object(service.os, "replace", side_effect=replace), patch.object(service.time, "sleep") as sleep:
                    service.atomic_json(target, payload)
                self.assertEqual(len(observed), 2)
                self.assertEqual(observed[0], observed[1])
                self.assertEqual(json.loads(target.read_text(encoding="utf-8")), {"healthy": True, "count": 1})
                sleep.assert_called_once_with(service.ATOMIC_REPLACE_DELAYS[0])
                self.assertEqual(list(Path(tmp).glob("*.tmp")), [])

    def test_permanent_sharing_failure_is_bounded_preserves_destination_and_cleans_temp(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "health.json"
            original = b'{"old":true}'
            target.write_bytes(original)
            error = sharing_error()
            with patch.object(service.os, "replace", side_effect=error) as replace, patch.object(service.time, "sleep") as sleep:
                with self.assertRaises(PermissionError) as failure:
                    service.atomic_json(target, {"new": True})
            self.assertIs(failure.exception, error)
            self.assertEqual(replace.call_count, len(service.ATOMIC_REPLACE_DELAYS) + 1)
            self.assertEqual([call.args[0] for call in sleep.call_args_list], list(service.ATOMIC_REPLACE_DELAYS))
            self.assertEqual(len({call.args[0] for call in replace.call_args_list}), 1)
            self.assertEqual(target.read_bytes(), original)
            self.assertEqual(list(Path(tmp).glob("*.tmp")), [])

    def test_nonsharing_errors_are_not_retried(self):
        for error in (OSError(28, "fixture disk full"), PermissionError(13, "fixture permission denied"), sharing_error(5, OSError)):
            with self.subTest(error=repr(error)), tempfile.TemporaryDirectory() as tmp:
                target = Path(tmp) / "health.json"
                with patch.object(service.os, "replace", side_effect=error) as replace, patch.object(service.time, "sleep") as sleep:
                    with self.assertRaises(OSError) as failure:
                        service.atomic_json(target, {"new": True})
                self.assertIs(failure.exception, error)
                replace.assert_called_once()
                sleep.assert_not_called()
                self.assertFalse(target.exists())
                self.assertEqual(list(Path(tmp).glob("*.tmp")), [])

    @unittest.skipUnless(os.name == "nt", "Actual Windows non-delete-sharing file lock")
    def test_real_windows_reader_lock_releases_then_same_json_replacement_succeeds(self):
        from ctypes import wintypes as w
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, ctypes.c_void_p, w.DWORD, w.DWORD, w.HANDLE]
        kernel.CreateFileW.restype = w.HANDLE
        kernel.CloseHandle.argtypes = [w.HANDLE]
        kernel.CloseHandle.restype = w.BOOL
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "health.json"
            target.write_text('{"old":true}', encoding="utf-8")
            # READ + WRITE sharing, deliberately without FILE_SHARE_DELETE.
            handle = kernel.CreateFileW(str(target), 0x80000000, 3, None, 3, 0x80, None)
            self.assertNotEqual(handle, ctypes.c_void_p(-1).value)
            state, lock = {"closed": False}, threading.Lock()
            def close_lock():
                with lock:
                    if not state["closed"]:
                        kernel.CloseHandle(handle)
                        state["closed"] = True
            def delayed_release():
                time.sleep(0.05)
                close_lock()
            release = threading.Thread(target=delayed_release)
            release.start()
            try:
                real_replace = os.replace
                with patch.object(service.os, "replace", wraps=real_replace) as replace:
                    service.atomic_json(target, {"healthy": True, "count": 2, "text": "真实锁"})
                self.assertGreater(replace.call_count, 1)
                self.assertLessEqual(replace.call_count, len(service.ATOMIC_REPLACE_DELAYS) + 1)
                self.assertEqual(json.loads(target.read_text(encoding="utf-8")), {"healthy": True, "count": 2, "text": "真实锁"})
                self.assertEqual(list(Path(tmp).glob("*.tmp")), [])
            finally:
                close_lock()
                release.join(timeout=1)


class SupervisorFailureTests(unittest.TestCase):
    def fixture(self, tmp):
        supervisor = service.Supervisor.__new__(service.Supervisor)
        supervisor.directory = Path(tmp)
        supervisor.config = {"healthPort": 28985, "serverDir": "fixture"}
        supervisor.run_id, supervisor.fault = "fixture-run", None
        supervisor.quit = supervisor.stop_requested = False
        supervisor.snapshot = {"healthy": True, "heartbeatEpoch": time.time(), "services": []}
        supervisor.children = {role: Mock(process=None) for role in service.ROLES}
        supervisor.audit, supervisor.job, supervisor.lock = Mock(), Mock(), Mock()
        return supervisor

    def test_tick_failure_is_audited_persisted_unhealthy_and_rethrown_inside_owned_boundary(self):
        with tempfile.TemporaryDirectory() as tmp:
            supervisor = self.fixture(tmp)
            supervisor.tick = Mock(side_effect=RuntimeError("fixture tick failure"))
            http, handler = Mock(), {}
            def create_http(address, implementation):
                self.assertEqual(address, ("127.0.0.1", 28985))
                handler["implementation"] = implementation
                return http
            with patch.object(service, "ThreadingHTTPServer", side_effect=create_http), patch.object(service.threading, "Thread"), patch.object(service.signal, "signal"):
                with self.assertRaisesRegex(RuntimeError, "fixture tick failure"):
                    supervisor.run()
            logged = json.loads(supervisor.audit.error.call_args_list[0].args[0])
            self.assertEqual(logged["kind"], "supervisor_failed")
            self.assertEqual(logged["phase"], "supervision_tick")
            self.assertEqual(logged["errorType"], "RuntimeError")
            self.assertIn("RuntimeError: fixture tick failure", logged["traceback"])
            persisted = service.read_json(Path(tmp) / "health.json")
            self.assertFalse(persisted["healthy"])
            self.assertEqual(persisted["state"], "failed")
            self.assertTrue(persisted["shutdownRequested"])
            self.assertFalse(persisted["paused"])
            supervisor.job.close.assert_called_once()
            supervisor.lock.close.assert_called_once()
            http.shutdown.assert_called_once()
            http.server_close.assert_called_once()
            for child in supervisor.children.values():
                child.handler.close.assert_called_once()
                child.stop.assert_not_called()
            # Execute the real GET handler with fixture I/O, no listening socket.
            for value, expected_status in ((supervisor.snapshot, 503), ({"healthy": True, "heartbeatEpoch": time.time() - 16}, 503),
                    ({"healthy": True, "heartbeatEpoch": time.time()}, 200)):
                supervisor.snapshot = value
                request = handler["implementation"].__new__(handler["implementation"])
                request.headers, request.path = {"Host": "127.0.0.1:28985"}, "/healthz"
                request.send_response, request.send_header, request.end_headers = Mock(), Mock(), Mock()
                request.wfile = io.BytesIO()
                request.do_GET()
                request.send_response.assert_called_once_with(expected_status)
                response = json.loads(request.wfile.getvalue())
                self.assertEqual(response["healthy"], expected_status == 200)

    def test_original_failure_is_not_masked_when_failure_health_cannot_be_written(self):
        with tempfile.TemporaryDirectory() as tmp:
            supervisor = self.fixture(tmp)
            error = sharing_error()
            supervisor.tick = Mock(side_effect=error)
            with patch.object(service, "ThreadingHTTPServer"), patch.object(service.threading, "Thread"), patch.object(service.signal, "signal"), \
                    patch.object(service, "atomic_json", side_effect=OSError(28, "fixture unavailable disk")):
                with self.assertRaises(PermissionError) as failure:
                    supervisor.run()
            self.assertIs(failure.exception, error)
            logged = [json.loads(call.args[0]) for call in supervisor.audit.error.call_args_list]
            self.assertEqual([entry["kind"] for entry in logged], ["supervisor_failed", "failure_state_write_failed"])
            self.assertFalse(supervisor.snapshot["healthy"])
            supervisor.job.close.assert_called_once()

    def test_health_server_start_failure_is_also_audited_without_shutdown_deadlock(self):
        with tempfile.TemporaryDirectory() as tmp:
            supervisor = self.fixture(tmp)
            with patch.object(service, "ThreadingHTTPServer", side_effect=OSError("fixture socket unavailable")):
                with self.assertRaisesRegex(OSError, "fixture socket unavailable"):
                    supervisor.run()
            logged = json.loads(supervisor.audit.error.call_args_list[0].args[0])
            self.assertEqual(logged["phase"], "health_server_start")
            self.assertFalse(service.read_json(Path(tmp) / "health.json")["healthy"])
            supervisor.job.close.assert_called_once()


class Layout:
    def __init__(self, temporary):
        self.root = Path(temporary) / "runtime"
        self.repo = Path(temporary) / "worktree"
        self.server = self.root / "server"
        self.repo.mkdir()
        self.server.mkdir(parents=True)
        self.java = Path(temporary) / "java.exe"
        self.node = Path(temporary) / "node.exe"
        self.java.touch()
        self.node.touch()
        (self.server / "server.properties").write_text("server-ip=127.0.0.1\nserver-port=28976\nenable-rcon=false\n", encoding="utf-8")
        (self.server / "eula.txt").write_text("eula=true\n", encoding="utf-8")
        self.raw = {"schemaVersion": 1, "serverDir": str(self.server), "healthPort": 28985,
            "services": [{"id": role, "command": [str(self.java if role == "java" else self.node), "fixture-only"],
                "cwd": str(self.server if role == "java" else self.repo), "port": port}
                for role, port in zip(service.ROLES, (28976, 28977, 28984))]}
        self.path = Path(temporary) / "config.json"

    def load(self, raw=None):
        self.path.write_text(json.dumps(raw or self.raw), encoding="utf-8")
        return service.load_config(self.path, expected_root=self.root, expected_repo=self.repo)


class ConfigTests(unittest.TestCase):
    def test_real_port_and_dependencies_and_no_env_projection(self):
        with tempfile.TemporaryDirectory() as tmp:
            layout = Layout(tmp)
            config = layout.load()
            self.assertEqual(config["gamePort"], 28976)
            self.assertEqual(config["services"][2]["healthUrl"], "http://127.0.0.1:28984/healthz")
            self.assertEqual(config["services"][1]["dependsOn"], ["java"])
            self.assertEqual(config["services"][0]["stopText"], "stop")

    def test_refuses_production_wrong_loopback_wrong_health_and_shell(self):
        with tempfile.TemporaryDirectory() as tmp:
            layout = Layout(tmp)
            for change in ({"serverDir": str(Path(tmp) / "old25565")}, {"healthPort": 25565}):
                with self.subTest(change=change), self.assertRaises(ValueError):
                    layout.load({**layout.raw, **change})
            for value in ("25565", "25575", "28976.0", "２８９７６", "0", "65536"):
                (layout.server / "server.properties").write_text(f"server-ip=127.0.0.1\nserver-port={value}\n", encoding="utf-8")
                with self.subTest(port=value), self.assertRaises(ValueError):
                    layout.load()
            for host in ("", "0.0.0.0", "192.168.3.163"):
                (layout.server / "server.properties").write_text(f"server-ip={host}\nserver-port=28976\n", encoding="utf-8")
                with self.subTest(host=host), self.assertRaises(ValueError):
                    layout.load()
            (layout.server / "server.properties").write_text("server-ip=127.0.0.1\nserver-port=28976\n", encoding="utf-8")
            raw = copy.deepcopy(layout.raw)
            raw["services"][1]["command"] = ["cmd.exe", "/c", "node whatever"]
            with self.assertRaises(ValueError):
                layout.load(raw)
            raw["services"][1]["command"] = [str(layout.node), "bad\nline"]
            with self.assertRaises(ValueError):
                layout.load(raw)

    def test_property_drift_is_not_silently_retargeted(self):
        with tempfile.TemporaryDirectory() as tmp:
            layout = Layout(tmp)
            layout.load()
            (layout.server / "server.properties").write_text("server-ip=127.0.0.1\nserver-port=28978\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "retarget"):
                service.check_server(layout.server, 28976)


class LocalRequestTests(unittest.TestCase):
    def supervisor(self, tmp):
        value = service.Supervisor.__new__(service.Supervisor)
        value.directory = Path(tmp)
        (value.directory / "requests").mkdir()
        (value.directory / "replies").mkdir()
        value.audit = Mock()
        value.apply = Mock(return_value={"ok": True, "resultKnown": False, "state": "delivered"})
        return value

    def write(self, supervisor, request):
        service.atomic_json(supervisor.directory / "requests" / (request["requestId"] + ".json"), request)

    def test_duplicate_is_never_executed_and_conflict_preserves_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            supervisor = self.supervisor(tmp)
            request = {"requestId": "one", "action": "console", "command": "list", "createdAtEpoch": time.time()}
            self.write(supervisor, request)
            supervisor.requests()
            receipt_path = supervisor.directory / "replies" / "one.json"
            original = receipt_path.read_bytes()
            self.write(supervisor, {**request, "createdAtEpoch": time.time()})
            supervisor.requests()
            self.write(supervisor, {**request, "command": "give unsafe other"})
            supervisor.requests()
            self.assertEqual(supervisor.apply.call_count, 1)
            self.assertEqual(receipt_path.read_bytes(), original)

    def test_expired_request_never_replays(self):
        with tempfile.TemporaryDirectory() as tmp:
            supervisor = self.supervisor(tmp)
            self.write(supervisor, {"requestId": "expired", "action": "resume", "createdAtEpoch": time.time() - 61})
            supervisor.requests()
            supervisor.apply.assert_not_called()
            result = service.read_json(supervisor.directory / "replies" / "expired.json")
            self.assertFalse(result["ok"])
            self.assertTrue(result["resultKnown"])

    def test_missing_stale_supervisor_does_not_submit(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            service.atomic_json(directory / "health.json", {"heartbeatEpoch": time.time() - 30, "serverDir": "fixture"})
            with self.assertRaisesRegex(RuntimeError, "stale"):
                service.submit({"runtimeDir": str(directory), "serverDir": "fixture"}, {"action": "stop"}, wait=0)
            self.assertFalse((directory / "requests").exists())

    def test_console_is_single_line_guarded_and_never_means_completion(self):
        for value in ("", "stop", "restart", "list\nstop", "list\rstop", "list\0", "x" * 2049):
            with self.subTest(value=value), self.assertRaises(ValueError):
                service.guard_console(value)
        self.assertEqual(service.guard_console(" /list "), "list")
        self.assertEqual(service.guard_console("locate structure minecraft:village_plains"), "locate structure minecraft:village_plains")
        self.assertEqual(service.guard_console("setworldspawn 10 64 10"), "setworldspawn 10 64 10")
        self.assertEqual(service.guard_console("spawnpoint MawLife 10 64 10"), "spawnpoint MawLife 10 64 10")
        supervisor = service.Supervisor.__new__(service.Supervisor)
        child = Mock()
        supervisor.children = {"java": child}
        result = supervisor.apply({"action": "console", "command": "list"})
        child.send.assert_called_once_with("list")
        self.assertTrue(result["deliveryKnown"])
        self.assertFalse(result["resultKnown"])

    def test_pause_persists_and_resume_refuses_stopping(self):
        with tempfile.TemporaryDirectory() as tmp:
            supervisor = service.Supervisor.__new__(service.Supervisor)
            supervisor.directory = Path(tmp)
            supervisor.config = {"serverDir": tmp, "gamePort": 28976}
            supervisor.children = {"java": Mock(stopping=True)}
            supervisor.quit, supervisor.stop_requested = False, False
            supervisor.apply({"action": "stop", "reason": "maint"})
            self.assertTrue(supervisor.paused())
            self.assertTrue(supervisor.stop_requested)
            with patch.object(service, "check_server"), self.assertRaisesRegex(RuntimeError, "pending"):
                supervisor.apply({"action": "resume"})
            self.assertTrue(supervisor.paused())


class ChildTests(unittest.TestCase):
    def child(self, tmp):
        spec = {"id": "java", "command": ["not-executed"], "cwd": tmp, "env": {},
                "port": 28976, "startupTimeoutSeconds": 180, "stopMode": "stdin", "stopText": "stop"}
        return service.Child(spec, Path(tmp), Mock())

    def test_occupied_port_never_adopts_or_terminates_discovered_process(self):
        with tempfile.TemporaryDirectory() as tmp:
            child = self.child(tmp)
            with patch.object(service, "reserve_port", side_effect=OSError("occupied")), patch.object(service.subprocess, "Popen") as popen:
                child.start()
            popen.assert_not_called()
            self.assertIsNone(child.process)
            self.assertIn("launch_refused", child.problem)
            self.assertGreater(child.next_start, time.monotonic())
            child.handler.close()

    def test_stop_sends_only_owned_stdin_and_timeout_does_not_kill(self):
        with tempfile.TemporaryDirectory() as tmp:
            child = self.child(tmp)
            process = Mock()
            process.poll.return_value = None
            process.stdin = io.StringIO()
            child.process = process
            child.stop()
            self.assertEqual(process.stdin.getvalue(), "stop\n")
            child.stop_started = time.monotonic() - 91
            child.tick()
            self.assertIn("stop_timeout", child.problem)
            process.terminate.assert_not_called()
            process.kill.assert_not_called()
            child.handler.close()

    def test_restart_storm_is_bounded(self):
        with tempfile.TemporaryDirectory() as tmp:
            child = self.child(tmp)
            child.starts = [time.monotonic()] * 6
            with patch.object(service.subprocess, "Popen") as popen:
                child.start()
            popen.assert_not_called()
            self.assertIn("restart_budget", child.problem)
            child.handler.close()

    def test_failed_java_stops_worker_then_gate_without_deadlock(self):
        with tempfile.TemporaryDirectory() as tmp:
            supervisor = service.Supervisor.__new__(service.Supervisor)
            supervisor.directory = Path(tmp)
            supervisor.config = {"serverDir": "fixture", "gamePort": 28976}
            supervisor.run_id, supervisor.fault = "fixture", None
            supervisor.quit, supervisor.stop_requested = False, False
            supervisor.requests = Mock()
            supervisor.paused = Mock(return_value=False)
            rows = {}
            for role, ready, dependencies in zip(service.ROLES, (False, True, True), ([], ["java"], ["gate"])):
                child = Mock()
                child.ready, child.process, child.next_start = ready, object(), 0
                child.spec = {"dependsOn": dependencies}
                child.state.return_value = {"ready": ready}
                rows[role] = child
            supervisor.children = rows
            with patch.object(service, "check_server"):
                supervisor.tick()
                rows["worker"].stop.assert_called_once()
                rows["gate"].stop.assert_not_called()
                rows["worker"].process = None
                supervisor.tick()
                rows["gate"].stop.assert_called_once()


class KernelOwnershipTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Windows kernel ownership check")
    def test_only_own_loopback_listener_is_accepted(self):
        with socket.socket() as fixture:
            fixture.bind(("127.0.0.1", 0))
            fixture.listen()
            port = fixture.getsockname()[1]
            service.check_owned_listener(port, os.getpid())
            with self.assertRaisesRegex(RuntimeError, "not owned"):
                service.check_owned_listener(port, 2147483647)
        with socket.socket() as fixture:
            fixture.bind(("0.0.0.0", 0))
            fixture.listen()
            with self.assertRaisesRegex(RuntimeError, "exposed"):
                service.check_owned_listener(fixture.getsockname()[1], os.getpid())

    @unittest.skipUnless(os.name == "nt" and socket.has_ipv6, "Windows IPv6 ownership check")
    def test_additional_public_ipv6_listener_is_rejected(self):
        with socket.socket() as ipv4, socket.socket(socket.AF_INET6) as ipv6:
            ipv4.bind(("127.0.0.1", 0))
            ipv4.listen()
            port = ipv4.getsockname()[1]
            ipv6.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
            ipv6.bind(("::", port))
            ipv6.listen()
            with self.assertRaisesRegex(RuntimeError, "IPv6 listener exposed"):
                service.check_owned_listener(port, os.getpid())


class WorkerHealthTests(unittest.TestCase):
    def test_http_200_without_ready_true_is_not_healthy(self):
        import http.client
        for payload in ({"ready": False}, {"ok": True}, {"ready": True, "healthy": False}):
            connection = Mock()
            response = connection.getresponse.return_value
            response.status = 200
            response.read.return_value = json.dumps(payload).encode()
            with self.subTest(payload=payload), patch.object(http.client, "HTTPConnection", return_value=connection), self.assertRaises(ValueError):
                service.probe_service({"readiness": "http", "port": 28984})
            connection.close.assert_called_once()

    def test_actual_worker_ready_and_agent_details_are_read(self):
        import http.client
        connection = Mock()
        response = connection.getresponse.return_value
        response.status = 200
        response.read.return_value = json.dumps({"ready": True,
            "agent": {"details": {"connected": True, "username": "MawLife", "privateToken": "must-not-project"}}}).encode()
        with patch.object(http.client, "HTTPConnection", return_value=connection):
            result = service.probe_service({"readiness": "http", "port": 28984})
        self.assertTrue(result["workerReady"])
        self.assertEqual(result["agentDetails"], {"connected": True, "username": "MawLife"})

    @unittest.skipUnless(os.name == "nt", "Windows job object check")
    def test_job_creation_and_close_without_assigning_any_real_process(self):
        job = service.WindowsJob()
        self.assertTrue(job.handle)
        job.close()
        self.assertIsNone(job.handle)


class StartupFallbackTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "PowerShell startup registration logic")
    def test_denied_tasks_fall_back_to_only_new_hkcu_value(self):
        # Execute the actual Register branch and functions, substituting every
        # system mutation. This is not an actual scheduled-task/registry setup.
        source = Path(service.__file__).with_name("maw_service_task.ps1")
        with tempfile.TemporaryDirectory() as tmp:
            record = Path(tmp) / "startup.json"
            code = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile('__SOURCE__', [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Script parsing failed' }
foreach ($function in $ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.FunctionDefinitionAst] }) {
    . ([ScriptBlock]::Create($function.Extent.Text))
}
$taskName = 'MyAgentWorld.Service.28976'
$pythonw = 'C:\fixture\pythonw.exe'
$argument = 'fixture-only'
$runCommand = 'fixture-only-command'
$account = 'fixture-user'
$PSScriptRoot = 'C:\fixture'
$recordPath = '__RECORD__'
$runKey = 'HKCU:\fixture-only'
$plan = [pscustomobject]@{ runtimeDir='fixture'; healthPort=28985 }
$StartupMethod = 'Auto'
$script:runValue = $null
function Initialize-PrivateMailbox {}
function Get-ServiceShortcut { return $null }
function Get-RunValue { return $script:runValue }
function Get-ScheduledTask { [CmdletBinding()]param($TaskName) return $null }
function New-ScheduledTaskAction { [CmdletBinding()]param($Execute,$Argument,$WorkingDirectory) return @{} }
function New-ScheduledTaskTrigger { [CmdletBinding()]param([switch]$AtStartup,[switch]$AtLogOn,$User) return @{} }
function New-ScheduledTaskPrincipal { [CmdletBinding()]param($UserId,$LogonType,$RunLevel) return @{LogonType=$LogonType} }
function New-ScheduledTaskSettingsSet { [CmdletBinding()]param($RestartCount,$RestartInterval,$MultipleInstances,$ExecutionTimeLimit,[switch]$AllowStartIfOnBatteries,[switch]$DontStopIfGoingOnBatteries) return @{} }
function Register-ScheduledTask { [CmdletBinding()]param($TaskName,$Action,$Trigger,$Principal,$Settings,[switch]$Force) Write-Error 'Access is denied' }
function Test-Path { [CmdletBinding()]param($LiteralPath,$PathType) return $false }
function New-Item { [CmdletBinding()]param($Path,[switch]$Force) if ($Path -ne $runKey) { throw 'Unexpected key mutation' } }
function New-ItemProperty { [CmdletBinding()]param($LiteralPath,$Name,$Value,$PropertyType,[switch]$Force)
    if ($LiteralPath -ne $runKey -or $Name -ne $taskName) { throw 'Foreign startup entry mutation' }
    $script:runValue=$Value
}
$branch = $ast.EndBlock.Statements | Where-Object {
    $_ -is [System.Management.Automation.Language.IfStatementAst] -and $_.Clauses[0].Item1.Extent.Text -eq '$Mode -eq ''Register'''
}
if (@($branch).Count -ne 1) { throw 'Actual register branch not found' }
$body = $branch.Clauses[0].Item2.Extent.Text
. ([ScriptBlock]::Create($body.Substring(1, $body.Length - 2)))
""".replace("__SOURCE__", str(source)).replace("__RECORD__", str(record))
            result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand",
                base64.b64encode(code.encode("utf-16le")).decode()], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            actual = json.loads(record.read_text(encoding="utf-8-sig"))
            self.assertEqual(actual["method"], "Run")
            self.assertFalse(actual["started"])
            self.assertFalse(actual["preLoginBootStartup"])
            self.assertEqual([item["method"] for item in actual["failures"]], ["S4U", "Interactive"])
            self.assertTrue(all("denied" in item["reason"] for item in actual["failures"]))


if __name__ == "__main__":
    unittest.main()
