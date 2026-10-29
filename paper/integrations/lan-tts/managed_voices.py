"""LAN voice registration for the existing VoxCPM2 single-worker service.

Audio is uploaded, never fetched from a caller-supplied URL or filesystem path.
Registration does not load another model or change any existing default voice.
"""
from __future__ import annotations

import base64
from email.parser import BytesParser
from email.policy import default
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import threading
import uuid

from voice_catalog import VoiceCatalog, VoiceReference, SCHEMA

MAX_UPLOAD = 32 * 1024 * 1024
MAX_REQUEST = 46 * 1024 * 1024
VOICE_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,95}')


class VoiceError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def parse_upload(content_type, raw):
    if len(raw) > MAX_REQUEST:
        raise VoiceError('Audio upload exceeds 32 MiB', 413)
    if content_type.split(';', 1)[0].strip().lower() == 'application/json':
        body = json.loads(raw)
        if not isinstance(body, dict):
            raise VoiceError('Expected a JSON object')
        encoded = body.get('reference_audio', body.get('audio_base64'))
        if encoded is not None:
            if not isinstance(encoded, str):
                raise VoiceError('reference_audio must be base64 audio')
            if encoded.startswith('data:'):
                encoded = encoded.split(',', 1)[-1]
            body['audio'] = base64.b64decode(encoded, validate=True)
        return body
    if content_type.lower().startswith('multipart/form-data;'):
        message = BytesParser(policy=default).parsebytes(
            ('Content-Type: ' + content_type + '\r\nMIME-Version: 1.0\r\n\r\n').encode() + raw)
        if not message.is_multipart():
            raise VoiceError('Invalid multipart form')
        body = {}
        for part in message.iter_parts():
            name = part.get_param('name', header='content-disposition')
            name = 'audio' if name in ('file', 'audio', 'reference_audio') else name
            if not name or name in body:
                raise VoiceError('Missing or duplicate upload field')
            value = part.get_payload(decode=True)
            body[name] = value if name == 'audio' else value.decode('utf-8')
        return body
    raise VoiceError('Use application/json or multipart/form-data', 415)


class ManagedVoiceCatalog(VoiceCatalog):
    def __init__(self, config):
        self._lock = threading.RLock()
        super().__init__(config)
        self._builtins = frozenset(self.references)
        self.root = Path(config.get('managed_voice_dir', '/var/lib/cormy-tts/voices')).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.index = self.root / 'catalog.json'
        self._rows = {}
        if self.index.exists():
            body = json.loads(self.index.read_text(encoding='utf-8'))
            if body.get('schema') != SCHEMA or not isinstance(body.get('voices'), list):
                raise VoiceError('Invalid managed voice catalog')
            for row in body['voices']:
                self._add(row, self.root)
                self._rows[row['id']] = row

    def resolve(self, voice=None):
        # Immutable snapshots let queued synthesis finish with its original voice
        # even when the same ID is updated or deleted by another HTTP request.
        if isinstance(voice, VoiceReference):
            return voice
        with self._lock:
            return super().resolve(voice)

    def public(self):
        with self._lock:
            body = super().public()
            body['voice_management'] = {
                'enabled': True, 'authentication': 'trusted-lan',
                'create': 'POST /v1/audio/voices',
                'update': 'PUT /v1/audio/voices/{id}',
                'delete': 'DELETE /v1/audio/voices/{id}',
                'reference_audio': 'GET /v1/audio/voices/{id}/audio',
                'upload': ['multipart: file + reference_text', 'JSON: reference_audio(base64) + reference_text'],
                'max_audio_bytes': MAX_UPLOAD, 'max_reference_seconds': 300,
                'default_unchanged': True,
            }
            for row in body['catalog']:
                row['editable'] = row['id'] not in self._builtins
            return body

    def details(self, vid):
        with self._lock:
            ref = self.resolve(vid)
            return {**ref.public(), 'reference_text': ref.reference_text,
                    'editable': ref.id not in self._builtins,
                    'reference_audio_url': '/v1/audio/voices/' + ref.id + '/audio'}

    def _commit(self, rows):
        temp = self.index.with_name('.catalog-' + uuid.uuid4().hex + '.json')
        try:
            with temp.open('x', encoding='utf-8') as handle:
                json.dump({'schema': SCHEMA, 'voices': list(rows.values())}, handle,
                          ensure_ascii=False, indent=2, allow_nan=False)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, self.index)
        finally:
            temp.unlink(missing_ok=True)

    def _audio(self, raw):
        import numpy as np
        import soundfile as sf
        from scipy.signal import resample_poly
        if not isinstance(raw, bytes) or not 1 <= len(raw) <= MAX_UPLOAD:
            raise VoiceError('Upload a nonempty audio file of at most 32 MiB', 413)
        try:
            info = sf.info(io.BytesIO(raw))
            if not 0.25 <= info.duration <= 300 or info.channels > 8:
                raise VoiceError('Reference audio must be 0.25 to 300 seconds; 5 to 20 seconds is recommended')
            audio, rate = sf.read(io.BytesIO(raw), dtype='float32', always_2d=True)
        except VoiceError:
            raise
        except Exception as exc:
            raise VoiceError('Cannot decode audio; upload WAV, FLAC, OGG or MP3') from exc
        if not np.isfinite(audio).all() or not audio.size:
            raise VoiceError('Reference audio contains invalid samples')
        audio = audio.mean(axis=1)
        if np.max(np.abs(audio)) < 0.00001:
            raise VoiceError('Reference audio is silent')
        divisor = math.gcd(rate, 24000)
        if rate != 24000:
            audio = resample_poly(audio, 24000 // divisor, rate // divisor)
        output = io.BytesIO()
        sf.write(output, audio, 24000, format='WAV', subtype='PCM_16')
        encoded = output.getvalue()
        digest = hashlib.sha256(encoded).hexdigest()
        target = self.root / (digest + '.wav')
        if not target.exists():
            temp = self.root / ('.audio-' + uuid.uuid4().hex)
            try:
                with temp.open('xb') as handle:
                    handle.write(encoded)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temp, target)
            finally:
                temp.unlink(missing_ok=True)
        return target.name, digest, len(audio) / 24000

    def put(self, body, vid=None, *, create=True):
        if not isinstance(body, dict):
            raise VoiceError('Expected an object')
        vid = vid or body.get('id') or 'voice-' + uuid.uuid4().hex[:16]
        if not isinstance(vid, str) or not VOICE_ID.fullmatch(vid) or vid == 'default':
            raise VoiceError('id must be 1 to 96 letters, digits, dots, underscores or hyphens')
        with self._lock:
            exists = vid in self.references
            if create and exists:
                raise VoiceError('Voice already exists; use PUT to update or choose another id', 409)
            if not create and not exists:
                raise VoiceError('Voice not found; use POST to create it', 404)
            if vid in self._builtins:
                raise VoiceError('Preset voice is kept intact; POST a new id to create your own version', 409)
            row = dict(self._rows.get(vid, {}))
            row['id'] = vid
            text = body.get('reference_text', body.get('prompt_text', body.get('transcript', row.get('reference_text'))))
            if not isinstance(text, str) or not 1 <= len(text.strip()) <= 8192:
                raise VoiceError('reference_text is required: the exact words spoken in the reference audio')
            row['reference_text'] = text.strip()
            for key, limit, fallback in [('label', 200, vid), ('description', 2000, '')]:
                value = body.get(key, row.get(key, fallback))
                if not isinstance(value, str) or len(value) > limit:
                    raise VoiceError(key + ' must be a string of at most ' + str(limit) + ' characters')
                row[key] = value
            if 'audio' in body:
                row['reference_file'], row['reference_sha256'], row['reference_seconds'] = self._audio(body['audio'])
            elif create:
                raise VoiceError('file or reference_audio is required')
            # Reuse the original hash/format validation before publishing.
            validator = VoiceCatalog.__new__(VoiceCatalog)
            validator.references = {}
            validator._add(row, self.root)
            rows = {**self._rows, vid: row}
            self._commit(rows)
            self._rows = rows
            self.references[vid] = validator.references[vid]
            return self.details(vid)

    def delete(self, vid):
        with self._lock:
            if vid in self._builtins:
                raise VoiceError('Preset/default voices are retained; only uploaded voices can be deleted', 409)
            if vid not in self._rows:
                raise VoiceError('Voice not found', 404)
            rows = dict(self._rows)
            del rows[vid]
            self._commit(rows)
            self._rows = rows
            del self.references[vid]
            # Keep content-addressed audio: an in-flight request may still own it.
            return {'deleted': True, 'id': vid}


def voice_route(handler):
    """Return True when the request is a voice-management route."""
    from urllib.parse import unquote, urlsplit
    path = unquote(urlsplit(handler.path).path).rstrip('/')
    root = next((v for v in ('/v1/audio/voices', '/voices') if path == v or path.startswith(v + '/')), None)
    if root is None:
        return False
    catalog = handler.server.engine.voices
    try:
        suffix = path[len(root):].strip('/')
        method = handler.command
        if method == 'GET':
            if not suffix:
                result = catalog.public()
            elif suffix.endswith('/audio'):
                ref = catalog.resolve(suffix[:-6])
                handler.reply(200, Path(ref.reference_file).read_bytes(), 'audio/wav')
                return True
            else:
                result = catalog.details(suffix)
        elif method in ('POST', 'PUT'):
            if method == 'PUT' and not suffix or method == 'POST' and suffix:
                raise VoiceError('POST the collection to create; PUT an id to update', 405)
            length = int(handler.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_REQUEST:
                raise VoiceError('Upload request exceeds 46 MiB or has no Content-Length', 413)
            handler.connection.settimeout(60)
            body = parse_upload(handler.headers.get('Content-Type', ''), handler.rfile.read(length))
            result = catalog.put(body, suffix or None, create=method == 'POST')
        elif method == 'DELETE' and suffix:
            result = catalog.delete(suffix)
        else:
            raise VoiceError('Use GET, POST, PUT or DELETE', 405)
        handler.reply(201 if method == 'POST' else 200, json.dumps(result, ensure_ascii=False).encode())
    except (ValueError, TypeError, KeyError, OSError) as exc:
        status = getattr(exc, 'status', 404 if 'Unknown configured voice' in str(exc) else 400)
        # No local paths, transcripts or uploaded bytes in error logs.
        message = str(exc) if isinstance(exc, (ValueError, TypeError)) else 'Voice storage failed; nothing was published'
        handler.reply(status, json.dumps({'error': message}, ensure_ascii=False).encode())
    return True
