"""Durable, actor-bound speech; no model, world action or provider credentials."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import time
import uuid

TERMINAL = {'completed', 'cancelled', 'expired', 'failed'}
ID = re.compile(r'[a-zA-Z0-9_-]{1,100}\Z')
VOICE = re.compile(r'[a-zA-Z0-9_-]{1,64}\Z')
DIMENSION = re.compile(r'[a-z0-9_.-]+:[a-z0-9_./-]+\Z')


def read(path):
    if path.is_symlink() or path.stat().st_size > 65536:
        raise ValueError('speech_state_invalid')
    value = json.loads(path.read_text(encoding='utf-8-sig'))
    if not isinstance(value, dict):
        raise ValueError('speech_state_invalid')
    return value


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temp.open('x', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def actor_id(value):
    if not isinstance(value, str) or str(uuid.UUID(value)) != value:
        raise ValueError('speech_actor_invalid')
    return value


@contextmanager
def actor_lock(root, actor):
    path = root / 'speech-state' / (actor_id(actor) + '.lock')
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+b') as stream:
        if os.name == 'nt':
            import msvcrt
            stream.write(b'0')
            stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == 'nt':
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)


class SpeechBroker:
    def __init__(self, root, clock=time.time):
        self.root, self.clock = Path(root), clock

    def now(self):
        return int(self.clock() * 1000)

    def profile(self, actor):
        actor_id(actor)
        config = read(self.root / 'speech-profiles.json')
        row = config.get('actors', {}).get(actor)
        if config.get('schema') != 1 or not isinstance(row, dict) or row.get('enabled') is not True:
            raise ValueError('speech_profile_unavailable')
        if not isinstance(row.get('voiceId'), str) or not VOICE.fullmatch(row['voiceId']):
            raise ValueError('speech_voice_invalid')
        if not isinstance(row.get('version'), str) or not ID.fullmatch(row['version']):
            raise ValueError('speech_profile_version_invalid')
        return row

    def _state(self, actor):
        path = self.root / 'speech-state' / (actor_id(actor) + '.json')
        if not path.exists():
            return {'generation': 0}
        state = read(path)
        value = state.get('generation')
        if (state.get('schema') != 1 or state.get('entity') != actor
                or type(value) is not int or not 1 <= value < 2**52):
            raise ValueError('speech_generation_invalid')
        return state

    def generation(self, actor):
        return self._state(actor)['generation']

    def advance(self, actor, generation, index=None):
        if type(generation) is not int or not 1 <= generation < 2**52:
            raise ValueError('speech_generation_invalid')
        state = {'schema': 1, 'entity': actor, 'generation': generation, 'updatedAt': self.now()}
        if index is not None:
            state['recentIndex'] = index
        write(self.root / 'speech-state' / (actor + '.json'),
              state)

    def _validate_job(self, actor, row):
        if (not isinstance(row, dict) or row.get('schema') != 2 or row.get('entity') != actor
                or not isinstance(row.get('id'), str) or not ID.fullmatch(row['id'])
                or type(row.get('generation')) is not int or not 1 <= row['generation'] < 2**52
                or type(row.get('createdAt')) is not int or not 0 <= row['createdAt'] < 2**52
                or type(row.get('expiresAt')) is not int
                or not row['createdAt'] < row['expiresAt'] <= row['createdAt'] + 90000
                or not isinstance(row.get('text'), str) or not 1 <= len(row['text']) <= 160
                or not isinstance(row.get('dimension'), str) or not DIMENSION.fullmatch(row['dimension'])):
            raise ValueError('speech_index_invalid')

    def _index(self, actor, state):
        generation = state['generation']
        if 'recentIndex' in state:
            index = state['recentIndex']
            if (not isinstance(index, dict) or index.get('schema') != 1
                    or type(index.get('generation')) is not int or index['generation'] != generation
                    or type(index.get('lastAcceptedAt')) is not int
                    or not -1 <= index['lastAcceptedAt'] < 2**52
                    or not isinstance(index.get('reservations'), list) or len(index['reservations']) > 5):
                raise ValueError('speech_index_invalid')
            seen = set()
            for row in index['reservations']:
                self._validate_job(actor, row)
                if (row['generation'] != generation or row['id'] in seen
                        or row['createdAt'] > index['lastAcceptedAt']):
                    raise ValueError('speech_index_invalid')
                seen.add(row['id'])
            return index, False
        # One migration of legacy history, never a per-submit global scan.
        index = {'schema': 1, 'generation': generation, 'lastAcceptedAt': -1, 'reservations': []}
        for path in (self.root / 'speech-requests').glob('*.json'):
            try:
                row = read(path)
            except FileNotFoundError:
                continue
            if row.get('entity') != actor:
                continue
            self._validate_job(actor, row)
            if path.stem != row['id'] or row['generation'] > generation:
                raise ValueError('speech_index_invalid')
            index['lastAcceptedAt'] = max(index['lastAcceptedAt'], row['createdAt'])
            if (row['generation'] == generation and row['expiresAt'] > self.now()
                    and self.receipt(actor, row['id']).get('status') not in TERMINAL):
                index['reservations'].append(row)
                if len(index['reservations']) > 5:
                    raise ValueError('speech_index_overflow')
        return index, True

    def index_preview(self, actor):
        """Read-only migration diagnostic: no lock file, index write or dispatch."""
        state = self._state(actor)
        index, rebuild = self._index(actor, state)
        return {'ok': True, 'needsRebuild': rebuild, 'generation': state['generation'],
                'activeCount': sum(row['expiresAt'] > self.now() for row in index['reservations']),
                'lastAcceptedAt': index['lastAcceptedAt'], 'reservations': len(index['reservations'])}

    def migrate_recent(self, actor, dry_run=True):
        """Explicit legacy-index migration, preserving generation and all jobs."""
        if type(dry_run) is not bool:
            raise ValueError('speech_request_invalid')
        if dry_run:
            return self.index_preview(actor)
        with actor_lock(self.root, actor):
            state = self._state(actor)
            index, rebuild = self._index(actor, state)
            if rebuild and state['generation']:
                self.advance(actor, state['generation'], index)
            return {'ok': True, 'migrated': rebuild and state['generation'] > 0,
                    'generation': state['generation'], 'reservations': len(index['reservations']),
                    'dispatched': False}

    def _refresh_index(self, actor, index):
        recent = []
        for reserved in index['reservations']:
            path = self.root / 'speech-requests' / (reserved['id'] + '.json')
            if not path.exists():
                # Reservation committed but request publication was interrupted.
                # Preserve exact-ID history before pruning/cancelling its slot;
                # this record is NEVER added to text-queue or replayed.
                write(path, {**reserved, 'submissionUnconfirmed': True})
            job = read(path)
            if any(job.get(key) != reserved.get(key) for key in
                   ('schema', 'id', 'entity', 'generation', 'createdAt', 'expiresAt', 'text', 'dimension')):
                raise ValueError('speech_index_invalid')
            if (reserved['expiresAt'] > self.now()
                    and self.receipt(actor, reserved['id']).get('status') not in TERMINAL):
                recent.append(reserved)
        return {**index, 'reservations': recent}

    def receipt(self, actor, speech_id):
        actor_id(actor)
        if not isinstance(speech_id, str) or not ID.fullmatch(speech_id):
            raise ValueError('speech_id_invalid')
        job_path = self.root / 'speech-requests' / (speech_id + '.json')
        if not job_path.exists():
            state = self._state(actor)
            if 'recentIndex' in state:
                index, _ = self._index(actor, state)
                for row in index['reservations']:
                    if row['id'] == speech_id:
                        return self._unconfirmed_receipt(row)
            return {'ok': False, 'code': 'speech_not_found'}
        job = read(job_path)
        if job.get('entity') != actor:
            raise ValueError('speech_not_owned')
        receipt_path = self.root / 'speech-receipts' / (speech_id + '.json')
        receipt = read(receipt_path) if receipt_path.exists() else (
            {'status': 'unknown', 'code': 'speech_submission_unconfirmed'}
            if job.get('submissionUnconfirmed') else {'status': 'queued'})
        if receipt_path.exists() and (receipt.get('schema') != 2 or receipt.get('id') != speech_id
                or receipt.get('entity') != actor or receipt.get('generation') != job['generation']
                or receipt.get('status') not in (TERMINAL | {'synthesized', 'started'})):
            raise ValueError('speech_receipt_invalid')
        status = receipt.get('status', 'queued')
        code = receipt.get('code', status)
        if not isinstance(code, str) or len(code) > 100:
            raise ValueError('speech_receipt_invalid')
        if status not in TERMINAL and self.generation(actor) != job['generation']:
            status, code = 'cancellation_requested', 'generation_changed'
        if status not in TERMINAL and self.now() >= job['expiresAt']:
            status, code = 'expired', 'expired'
        return {'ok': True, 'utteranceId': speech_id, 'status': status, 'code': code,
                'playbackCompleted': status == 'completed', 'retryAutomatically': False,
                'updatedAt': receipt.get('updatedAt', job['createdAt'])}

    def _unconfirmed_receipt(self, row):
        return {'ok': True, 'utteranceId': row['id'],
                'status': 'expired' if self.now() >= row['expiresAt'] else 'unknown',
                'code': 'speech_submission_unconfirmed', 'playbackCompleted': False,
                'retryAutomatically': False, 'updatedAt': row['createdAt']}

    def submit(self, actor, key, text, dimension, interrupt=False):
        actor_id(actor)
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 160 or any(ord(c) < 32 for c in text):
            raise ValueError('speech_text_invalid')
        if not isinstance(dimension, str) or not DIMENSION.fullmatch(dimension):
            raise ValueError('speech_dimension_invalid')
        if not isinstance(key, str) or not 1 <= len(key) <= 180 or type(interrupt) is not bool:
            raise ValueError('speech_request_invalid')
        profile = self.profile(actor)
        speech_id = 'speech-' + hashlib.sha256((actor + '\0' + key).encode()).hexdigest()[:40]
        path = self.root / 'speech-requests' / (speech_id + '.json')
        with actor_lock(self.root, actor):
            if path.exists():
                previous = read(path)
                if previous.get('text') != text.strip() or previous.get('dimension') != dimension:
                    raise ValueError('speech_request_conflict')
                return self.receipt(actor, speech_id)
            state = self._state(actor)
            index, rebuild = self._index(actor, state)
            generation = state['generation']
            if rebuild and generation:
                self.advance(actor, generation, index)
            # A previous process may have committed only its reservation. Never
            # redispatch the same identity even when the request file is absent.
            for reserved in index['reservations']:
                if reserved['id'] == speech_id:
                    if reserved['text'] != text.strip() or reserved['dimension'] != dimension:
                        raise ValueError('speech_request_conflict')
                    return self._unconfirmed_receipt(reserved)
            now = self.now()
            if index['lastAcceptedAt'] >= 0 and now - index['lastAcceptedAt'] < 10000:
                raise ValueError('speech_rate_limited')
            index = self._refresh_index(actor, index)
            if len(index['reservations']) >= 5 and not interrupt:
                raise ValueError('speech_queue_full')
            generation = generation + 1 if interrupt or generation == 0 else generation
            job = {'schema': 2, 'id': speech_id, 'entity': actor, 'voiceId': profile['voiceId'],
                   'voiceVersion': profile['version'], 'generation': generation,
                   'createdAt': now, 'expiresAt': now + 90000, 'dimension': dimension,
                   'scope': 'nearby', 'radius': 24, 'priority': 'urgent' if interrupt else 'normal',
                   'text': text.strip()}
            index = {**index, 'generation': generation, 'lastAcceptedAt': now,
                     'reservations': ([] if interrupt else index['reservations']) + [job]}
            # Durable reservation -> identity -> dispatch. Every ambiguous crash
            # occupies a slot until expiry; none authorizes automatic replay.
            self.advance(actor, generation, index)
            write(path, job)
            write(self.root / 'text-queue' / (speech_id + '.json'), job)
            return self.receipt(actor, speech_id)

    def maintain(self, actor):
        """Explicit audio GC. Identity/receipts persist for exact-ID deduplication.

        Metadata retention is intentional and unbounded; operator archival must
        preserve identity lookups. Admission never scans this retained history.
        The returned ``removed`` count refers only to deleted audio files.
        """
        actor_id(actor)
        with actor_lock(self.root, actor):
            state = self._state(actor)
            index, _ = self._index(actor, state)
            index = self._refresh_index(actor, index)
            if state['generation']:
                self.advance(actor, state['generation'], index)
            now = self.now()
            cleanup = {'code': 'speech_cleanup_deferred', 'deferred': 0, 'errors': []}
            removed = 0
            requests = self.root / 'speech-requests'
            for existing in requests.glob('*.json'):
                try:
                    row = read(existing)
                except FileNotFoundError:
                    continue  # Another actor may finish pruning its own history.
                if (isinstance(row.get('id'), str) and ID.fullmatch(row['id'])
                        and row.get('entity') == actor
                        and row.get('schema') == 2 and now - row['createdAt'] > 7 * 86400000
                        and row['expiresAt'] < now):
                    # Removing identity would let the same exact key replay.
                    # Retain the original request AND playback evidence forever;
                    # only this actor's expired audio may be garbage collected.
                    try:
                        audio = self.root / 'tts-queue' / (row['id'] + '.mp3')
                        if audio.exists():
                            audio.unlink(missing_ok=True)
                            removed += 1
                    except OSError as exc:
                        cleanup['deferred'] += 1
                        error = {'artifact': 'audio', 'error': type(exc).__name__}
                        if error not in cleanup['errors'] and len(cleanup['errors']) < 3:
                            cleanup['errors'].append(error)
                    continue
            result = {'ok': True, 'removed': removed}
            if cleanup['deferred']:
                result['cleanup'] = cleanup
            return result

    def cancel(self, actor):
        self.profile(actor)
        with actor_lock(self.root, actor):
            state = self._state(actor)
            index, _ = self._index(actor, state)
            self._refresh_index(actor, index)
            generation = state['generation'] + 1
            self.advance(actor, generation, {**index, 'generation': generation, 'reservations': []})
        return {'ok': True, 'code': 'speech_cancellation_requested', 'generation': generation,
                'playbackStoppedConfirmed': False, 'retryAutomatically': False}


class SpeechWorker:
    """One bounded local synthesis consumer; old generation results never play."""
    def __init__(self, broker, synthesize):
        self.broker, self.root, self.synthesize = broker, broker.root, synthesize

    def stale(self, job):
        if self.broker.now() >= job['expiresAt']:
            return 'expired'
        if self.broker.generation(job['entity']) != job['generation']:
            return 'cancelled'
        return None

    def report(self, job, status, code=None):
        write(self.root / 'speech-receipts' / (job['id'] + '.json'),
              {'schema': 2, 'id': job['id'], 'entity': job['entity'], 'generation': job['generation'],
               'status': status, 'code': code or status, 'updatedAt': self.broker.now()})

    def process(self, job):
        speech_id, actor = job.get('id'), job.get('entity')
        if not isinstance(speech_id, str) or not ID.fullmatch(speech_id):
            raise ValueError('speech_id_invalid')
        actor_id(actor)
        saved = read(self.root / 'speech-requests' / (speech_id + '.json'))
        if job != saved or job.get('schema') != 2:
            raise ValueError('speech_dispatch_mismatch')
        receipt = self.root / 'speech-receipts' / (speech_id + '.json')
        if receipt.exists() and read(receipt).get('status') in (TERMINAL | {'synthesized', 'started'}):
            return  # Unknown post-dispatch crash must not replay audio.
        try:
            reason = self.stale(job)
            if reason:
                self.report(job, reason)
                return
            profile = self.broker.profile(actor)
        except (ValueError, OSError):
            self.report(job, 'failed', 'speech_configuration_unavailable')
            return
        if (profile['voiceId'], profile['version']) != (job['voiceId'], job['voiceVersion']):
            self.report(job, 'cancelled', 'voice_profile_changed')
            return
        key = hashlib.sha256(json.dumps([job['voiceId'], job['voiceVersion'], job['text'],
                                       'mp3', 'indextts-local-v1'], ensure_ascii=False).encode()).hexdigest()
        cache = self.root / 'speech-cache'
        cache.mkdir(parents=True, exist_ok=True)
        cached = cache / (key + '.mp3')
        out = self.root / 'tts-queue' / (speech_id + '.mp3')
        out.parent.mkdir(parents=True, exist_ok=True)
        try:
            if cached.exists() and 0 <= self.broker.clock() - cached.stat().st_mtime < 7 * 86400:
                data = cached.read_bytes()
            else:
                data = self.synthesize(job['text'], job['voiceId'])
                if not isinstance(data, bytes) or not 1 <= len(data) <= 4 * 1024 * 1024:
                    raise ValueError('speech_audio_size_invalid')
                temp = cached.with_suffix('.tmp')
                temp.write_bytes(data)
                temp.replace(cached)
            reason = self.stale(job)
            if reason:
                self.report(job, reason)
                return
            temp = out.with_suffix('.tmp')
            temp.write_bytes(data)
            temp.replace(out)
            # Receipt first: ambiguous publication after a crash is not replayed.
            self.report(job, 'synthesized')
            write(out.with_suffix('.json'), {**job, 'file': 'data/godvoice/tts-queue/' + out.name})
        except Exception as exc:
            self.report(job, 'failed', 'synthesis_' + type(exc).__name__)
        finally:
            files = sorted(cache.glob('*.mp3'), key=lambda p: p.stat().st_mtime, reverse=True)
            total = 0
            for index, path in enumerate(files):
                total += path.stat().st_size
                if index >= 64 or total > 32 * 1024 * 1024 or self.broker.clock() - path.stat().st_mtime >= 7 * 86400:
                    path.unlink(missing_ok=True)


def delivery_order(path):
    """Synthesis must respect creation order too; ids are content-independent hashes."""
    try:
        row = read(path)
        stamp = row.get('createdAt') if row.get('schema') == 2 else int(path.stat().st_mtime * 1000)
        if type(stamp) is not int or stamp < 0:
            raise ValueError('speech_created_at_invalid')
        return stamp, path.stem
    except (OSError, ValueError, TypeError):
        return 0, path.stem  # Malformed input is claimed and rejected, never synthesized.
