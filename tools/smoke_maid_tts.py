"""Isolated new HTTP adapter + installed TLM decoder, without playback/LLM.

Default uses synthesized PCM silence. --source-url http://127.0.0.1:8100/tts
explicitly requests ONE fixed local TTS utterance (caches it for contract checks),
avoiding a second GPU model. This test-only backend is never installed in the API.
Production services/configuration are not changed. Output stays under runtime/.
Requires fastapi, uvicorn, lameenc, a JDK and the installed TLM JAR.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import socket
import subprocess
import threading
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import uuid
import wave

ROOT = Path(__file__).resolve().parents[1]
JAR = ROOT / "server/mc/mods/touhoulittlemaid-1.5.3-neoforge+mc1.21.1.jar"
EXPECTED_JAR_SHA256 = "ac7c07068be61216180a75e6845dc1e91f8c95a7c2e19ad241b81a127e7802dd"
FIXED_TEXT = "这是女仆语音兼容测试。"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def request(url, payload=None):
    body = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
    started = time.monotonic()
    try:
        with urlopen(Request(url, data=body, headers={"Content-Type": "application/json"}), timeout=35) as response:
            data = response.read(8 * 1024 * 1024 + 1)
            if len(data) > 8 * 1024 * 1024:
                raise ValueError("Unexpectedly large audio response")
            return response.status, dict(response.headers), data, time.monotonic() - started
    except HTTPError as error:
        return error.code, dict(error.headers), error.read(2048), time.monotonic() - started


class QaBackend:
    def __init__(self, source_url):
        self.source_url = source_url
        self.wav = None
        self.local_synthesis_requests = 0
        self.source_seconds = 0
        self.source_artifact = None

    def infer(self, **kwargs):
        if self.wav is None:
            if self.source_url:
                status, headers, data, elapsed = request(self.source_url, {
                    "text": FIXED_TEXT, "text_lang": "zh", "ref_audio_path": "/voices/touhou_little_maid.wav"})
                self.local_synthesis_requests += 1
                if status != 200 or not data.startswith(b"RIFF"):
                    raise RuntimeError("Local TTS did not return the expected PCM WAV")
                self.source_seconds = elapsed
                disposition = next((v for k, v in headers.items() if k.lower() == "content-disposition"), "")
                match = re.search(r'filename="([0-9a-f]{32}\.wav)"', disposition)
                # Keep only our exact request's filename for optional parent cleanup;
                # never enumerate/read historical generated audio in the live service.
                self.source_artifact = match.group(1) if match else None
                self.wav = data
            else:
                output = io.BytesIO()
                with wave.open(output, "wb") as audio:
                    audio.setnchannels(1)
                    audio.setsampwidth(2)
                    audio.setframerate(22050)
                    audio.writeframes(b"\x00\x00" * 4410)
                self.wav = output.getvalue()
        Path(kwargs["output_path"]).write_bytes(self.wav)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-url", help="Explicit optional local legacy /tts source for one fixed real synthesis")
    args = parser.parse_args()
    if args.source_url:
        parsed = urlsplit(args.source_url)
        if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.path != "/tts"
                or parsed.username or parsed.password or parsed.query or parsed.fragment):
            parser.error("source must be a loopback http://127.0.0.1:PORT/tts URL")
    if digest(JAR) != EXPECTED_JAR_SHA256:
        raise ValueError("Installed TLM JAR changed; re-audit decoder before running this smoke")
    work = ROOT / "runtime" / ("maid-tts-qa-" + uuid.uuid4().hex[:12])
    work.mkdir(parents=True)
    output = work / "transient"
    output.mkdir()
    references = work / "references"
    references.mkdir()
    # Only a filename stand-in for the isolated adapter; the test backend ignores it.
    (references / "goddess.wav").write_bytes(b"QA-not-read")
    (references / "touhou_little_maid.wav").write_bytes(b"QA-not-read")
    source = ROOT / "world/tts/tts_api.py"
    spec = importlib.util.spec_from_file_location("qa_tts_api", source)
    api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(api)
    backend = QaBackend(args.source_url)
    api._tts = backend
    api.VOICE_DIR = str(references)
    api.TMP_DIR = str(output)
    api.app.router.on_startup.clear()  # Test-only injection; no GPU model reload.
    import uvicorn
    server = uvicorn.Server(uvicorn.Config(api.app, log_level="error", access_log=False))
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    thread = threading.Thread(target=lambda: server.run(sockets=[sock]), daemon=True)
    thread.start()
    report = {"ok": False, "mode": "isolated_http_with_one_local_tts" if args.source_url else "isolated_http_synthetic_pcm",
              "apiSha256": digest(source), "installedMaidJarSha256": digest(JAR),
              "llmRequests": 0, "audioPlayback": False, "runtimeConfigurationChanged": False}
    try:
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        assert server.started, "Isolated HTTP server did not start"
        base = f"http://127.0.0.1:{port}"
        status, _, body, _ = request(base + "/health")
        health = json.loads(body)
        assert status == 200 and health["maidMediaType"] == "audio/mpeg"
        assert backend.local_synthesis_requests == 0, "Health must not synthesize"
        payload = {"text": FIXED_TEXT, "text_lang": "zh", "ref_audio_path": "/voices/touhou_little_maid.wav",
                   "media_type": "ogg", "streaming_mode": True, "aux_ref_audio_paths": [], "text_split_method": "cut5"}
        status, headers, mp3, elapsed = request(base + "/tts/maid", payload)
        assert status == 200 and headers.get("content-type") == "audio/mpeg", f"maid status {status}"
        assert not mp3.startswith(b"RIFF"), "Maid endpoint returned WAV"
        (work / "maid.mp3").write_bytes(mp3)
        status, headers, wav, _ = request(base + "/tts", payload)
        assert status == 200 and headers.get("content-type") == "audio/wav" and wav.startswith(b"RIFF")
        (work / "legacy.wav").write_bytes(wav)
        status, headers, get_wav, _ = request(base + "/tts?text=qa")
        assert status == 200 and headers.get("content-type") == "audio/wav" and get_wav.startswith(b"RIFF")
        status, headers, get_mp3, _ = request(base + "/tts?text=qa&format=mp3")
        assert status == 200 and headers.get("content-type") == "audio/mpeg" and not get_mp3.startswith(b"RIFF")
        assert request(base + "/tts/maid", {"text": "x" * 601})[0] == 400
        assert request(base + "/tts/maid", {"text": "qa", "ref_audio_path": "/voices/unknown.wav"})[0] == 404
        # Response completion and the ASGI cleanup finally may race on separate threads.
        deadline = time.monotonic() + 2
        while list(output.iterdir()) and time.monotonic() < deadline:
            time.sleep(0.02)
        assert list(output.iterdir()) == [], "Request temporary audio was retained"
        decoded = subprocess.run(["java", "--class-path", str(JAR),
            str(ROOT / "world/tts/tests/DecodeTlmAudio.java"), str(work / "maid.mp3"), str(work / "legacy.wav")],
            capture_output=True, text=True, timeout=30, check=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        assert "TLM_MP3_DECODED_PCM_BYTES=" in decoded.stdout and "TLM_PCM_WAV_REJECTED=true" in decoded.stdout
        report.update(ok=True, localTtsRequests=backend.local_synthesis_requests,
            sourceSynthesisSeconds=round(backend.source_seconds, 3), maidResponseSeconds=round(elapsed, 3),
            newEndpointTemporaryFiles=0, legacyGetAndPostPreserved=True, invalidInputRejected=True,
            maidMp3Bytes=len(mp3), decoder=decoded.stdout.strip().splitlines(),
            legacySourceGeneratedFile=backend.source_artifact)
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        sock.close()
        report["isolatedServerStopped"] = not thread.is_alive()
        (work / "result.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"report": str(work / "result.json"), **report}, ensure_ascii=False))


if __name__ == "__main__":
    main()
