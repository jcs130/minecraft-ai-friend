"""Simple Voice Chat configuration and read-only, positive UDP health checks.

The native Java child owns voice; this module starts no daemon, records no audio,
and does not route inference or touch the old world's godvoice queues.
"""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import struct
import subprocess
import time
import uuid

ROOT = Path(r"E:\QiandengJiSocietyLab")
REPO = Path(__file__).resolve().parents[1]
NAME = "voicechat-neoforge-1.21.1-2.6.22.jar"
SHA256 = "63116a4d21bd57221482d971dd85822f7c723c210b60411670cdb0aa26873cac"
PING_V1 = uuid.UUID("58bc9ae9-c7a8-45e4-a11c-efbb67199425").bytes
HOST, PORT = "192.168.3.163", 28989
CHANNELS = tuple("voicechat:" + name for name in (
    "request_secret", "secret", "update_state", "state", "states", "remove_state",
    "add_group", "remove_group", "create_group", "set_group", "joined_group",
    "leave_group", "add_category", "remove_category"))


class VoiceUnavailable(RuntimeError):
    """A failed UDP challenge; debounce separately from game/config failures."""


def settings(host=HOST, port=PORT, *, advertised_host=None):
    # The UDP socket stays on its fixed interface. NAT advertisement is separate.
    if (host, port) not in ((HOST, PORT), ("127.0.0.1", 28980)):
        raise ValueError("Unexpected voice endpoint")
    advertised = f"{host}:{port}"
    if advertised_host is not None:
        if (host, port) != (HOST, PORT) or not isinstance(advertised_host, str):
            raise ValueError("Public voice advertisement is only supported for the main endpoint")
        name, separator, advertised_port = advertised_host.rpartition(":")
        labels = name.split(".")
        if (separator != ":" or advertised_port != str(port) or len(name) > 253
                or len(labels) < 2 or not any(c.isalpha() for c in name)
                or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in labels)):
            raise ValueError("Voice advertisedHost must be a DNS hostname with the fixed voice port")
        advertised = advertised_host
    return {"port": str(port), "bind_address": host, "voice_host": advertised,
        "max_voice_distance": "32.0", "whisper_distance": "8.0", "codec": "VOIP",
        "mtu_size": "1275", "tcp_rate_limit": "16", "keep_alive": "1000",
        "enable_groups": "false", "allow_recording": "true",
        "spectator_interaction": "false", "spectator_player_possession": "false",
        "force_voice_chat": "false", "login_timeout": "10000",
        "broadcast_range": "-1.0", "allow_pings": "true", "use_natives": "true",
        "threaded_server_support": "false"}


def render_config(host=HOST, port=PORT, *, advertised_host=None):
    return ("# My Agent World: optional Java proximity voice; no automatic recording\n"
        + "\n".join(f"{key}={value}" for key, value in settings(host, port, advertised_host=advertised_host).items()) + "\n")


def validate(server: Path, host=HOST, port=PORT, *, advertised_host=None, check_jar=True):
    from maw_service import properties
    expected = settings(host, port, advertised_host=advertised_host)
    actual = properties(server / "config/voicechat/voicechat-server.properties")
    for key, value in expected.items():
        if actual.get(key) != value:
            raise ValueError(f"Voice configuration changed: {key}")
    if check_jar and hashlib.sha256((server / "mods" / NAME).read_bytes()).hexdigest() != SHA256:
        raise ValueError("Voice JAR differs from the locked stable release")
    return {"host": host, "port": port, "advertisedHost": expected["voice_host"], "maxDistance": 32, "whisperDistance": 8,
        "clientRequiredForGame": False, "groupsEnabled": False}


def udp_probe(host=HOST, port=PORT, timeout=1.0):
    """SVC PingHandler v1, independent challenge checked against its exact echo.

    0xff + fixed ping UUID + MC byte-array length (24) + nonce UUID + i64 time.
    The original server replies with the raw final 24 bytes, without encryption.
    """
    ipaddress.IPv4Address(host)  # No health DNS/proxy dependency.
    if type(port) is not int or not 1 <= port <= 65535 or not .05 <= timeout <= 5:
        raise ValueError("Invalid voice probe endpoint/timeout")
    challenge = uuid.uuid4().bytes + struct.pack(">q", int(time.time() * 1000))
    request = b"\xff" + PING_V1 + b"\x18" + challenge
    started = time.monotonic()
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
        connection.settimeout(timeout)
        connection.connect((host, port))
        connection.send(request)
        if connection.recv(256) != challenge:
            raise ValueError("Voice ping returned an unrelated or malformed challenge")
    return {"protocol": "svc-ping-v1", "latencyMs": round((time.monotonic()-started)*1000, 2)}


def owned_udp(host, port, pid):
    """Inspect just this child and port, including wildcard/IPv6 exposures."""
    if os.name != "nt":
        raise ValueError("UDP ownership check requires the Windows production host")
    command = ("@(Get-NetUDPEndpoint -LocalPort " + str(int(port))
        + " -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess)"
        + " | ConvertTo-Json -Compress")
    result = subprocess.run(["powershell.exe", "-NoProfile", "-Command", command],
        capture_output=True, text=True, encoding="utf-8", timeout=12)
    if result.returncode:
        raise ValueError("Voice UDP ownership inspection failed")
    rows = json.loads(result.stdout or "[]")
    if isinstance(rows, dict):
        rows = [rows]
    if not rows or any(row.get("OwningProcess") != pid or row.get("LocalAddress") != host
            or row.get("LocalPort") != port for row in rows):
        raise ValueError("Voice UDP endpoint is missing or has unexpected ownership/address")
    return True


def health(*, check_firewall=True):
    from maw_service import load_config
    import http.client
    report = {"ok": False, "checks": {}, "scope": "Java voice server readiness; not audible microphone acceptance",
        "actualMicrophoneTested": False, "actualAudiblePlaybackTested": False,
        "bedrockVoiceSupported": False, "agentSpeechRecognitionEnabled": False}
    try:
        checks = report["checks"]
        spec = load_config(ROOT / "services/service.json")
        java_spec = next(row for row in spec["services"] if row["id"] == "java")
        report["configuration"] = validate(ROOT / "server", advertised_host=java_spec.get("voiceAdvertisedHost"))
        checks["locked-stable-artifact-and-config"] = True
        checks["voice-supervised-with-java"] = java_spec.get("voiceChat") == {"host": HOST, "port": PORT}
        gate_spec = next(row for row in spec["services"] if row["id"] == "gate")
        checks["optional-voice-channels"] = set(CHANNELS) <= set(gate_spec["env"].get("GATE_EXTRA_PLAY_CHANNELS", "").split(","))
        connection = http.client.HTTPConnection("127.0.0.1", 28985, timeout=3)
        try:
            connection.request("GET", "/healthz")
            response = connection.getresponse()
            state = json.loads(response.read(65537))
            if response.status != 200:
                raise ValueError("Native supervisor is not healthy")
        finally:
            connection.close()
        java = next(row for row in state["services"] if row["id"] == "java")
        checks["fresh-native-owner"] = (state.get("healthy") is True and not state.get("paused")
            and 0 <= time.time()-state.get("heartbeatEpoch", 0) < 20 and java.get("ready") is True)
        checks["voice-owned-by-native-java"] = owned_udp(HOST, PORT, java["pid"])
        report["ping"] = udp_probe()
        checks["positive-svc-ping"] = True
        voice_metrics = java.get("metrics", {}).get("voiceChat", {})
        checks["supervisor-voice-ping"] = voice_metrics.get("protocol") == "svc-ping-v1" and voice_metrics.get("ready") is True
        if check_firewall:
            command = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                str(REPO / "tools/maw_lan_firewall.ps1"), "-Voice", "-Mode", "Status"]
            if spec["networkExposure"].get("publicGameAccess"):
                command.append("-PublicGameAccess")
            result = subprocess.run(command,
                capture_output=True, text=True, encoding="utf-8", timeout=20)
            checks["voice-firewall"] = result.returncode == 0 and json.loads(result.stdout).get("ok") is True
        report["javaPid"] = java["pid"]
        report["ok"] = all(checks.values())
    except (OSError, ValueError, KeyError, TypeError, StopIteration, subprocess.TimeoutExpired) as error:
        report["error"] = type(error).__name__ + ": " + str(error)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("plan", "health"))
    args = parser.parse_args()
    value = ({"ok": True, "artifact": NAME, "sha256": SHA256, "settings": settings(),
        "noNewDaemon": True, "routerChanged": False, "requiresJavaClientModForVoice": True}
        if args.action == "plan" else health())
    print(json.dumps(value, ensure_ascii=False))
    raise SystemExit(0 if value["ok"] else 1)
