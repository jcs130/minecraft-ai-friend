"""Shared path guards for the isolated voice and ASR queue consumers."""
import json
import os
from pathlib import Path
import re
import time
from urllib.parse import urlsplit


def voice_root(name='GV_BASE', suffix=''):
    raw = os.environ.get(name)
    if not raw:
        raise RuntimeError(name + ' must explicitly identify the isolated voice queue')
    path = Path(raw).resolve()
    allowed = (Path(__file__).resolve().parents[2] / 'server/mc/data/godvoice'
               if os.name == 'nt' else Path('/godvoice'))
    expected = (allowed / suffix).resolve()
    if path != expected:
        raise RuntimeError(name + ' must identify the isolated godvoice directory')
    return path


def local_tts_url(raw):
    url = urlsplit(raw)
    # 8100 = legacy kokoro tts container; 8191 = IndexTTS-2.5 shim (WSL 3080Ti).
    # 2026-09-26: the "shim occupies 8100" assumption silently broke the voice
    # chain (no listener on 8100 => goddess went mute). Accept the real ports.
    if url.scheme != 'http' or url.hostname not in {'host.docker.internal', 'localhost', '127.0.0.1'} or url.port not in {8100, 8191} or url.username or url.password or url.path not in {'', '/'} or url.query or url.fragment:
        raise RuntimeError('TTS_LOCAL_URL must identify the local TTS service on port 8100 or 8191')
    return raw.rstrip('/')


def job_id(value):
    value = str(value)
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,120}', value):
        raise ValueError('Voice job id is not a safe file name')
    return value


def atomic_json(path, data):
    path = Path(path)
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    temp.replace(path)


def heartbeat(root, kind, **fields):
    atomic_json(Path(root) / ('.' + kind + '-health.json'),
                {'updated_at': time.time(), 'kind': kind, **fields})
