# -*- coding: utf-8 -*-
"""天耳 ASR 管线（本地 sherpa-onnx paraformer-small 版）：
mic/inbox/*.wav -> 误触/白名单过滤 -> ASR 转写 -> mic/outbox/*.json。
女神 bot（world/mc-god.ts）消费 outbox 把转写当发言处理。wav 移入 processed 留档。
2026-08-31 进程收编 docker：本文件即 shadow-asr 容器主程序（compose 见 ../docker-compose.yml）；
宿主直跑仅渡备用，路径 env 化（MIC_BASE/ASR_MODEL_DIR）。
"""
import json, os, time, glob, wave, math
from pathlib import Path
from voice_paths import voice_root, atomic_json, heartbeat, job_id

# A required isolated queue mount; production paths are never a fallback.
BASE = str(voice_root('MIC_BASE', 'mic'))
INBOX = os.path.join(BASE, 'inbox')
OUTBOX = os.path.join(BASE, 'outbox')
PROCESSED = os.path.join(BASE, 'processed')
PROCESSING = os.path.join(BASE, 'processing')
MODEL_DIR = os.environ.get('ASR_MODEL_DIR', '')
POLL = 1.0
# 语音回应白名单（2026-08-30 造物主定）：只有萌萌的游戏内语音会被转写并投递给女神；
# 其他玩家的语音段直接归档，不转写、不回应。
VOICE_ALLOWED_PLAYERS = {name.strip() for name in os.environ.get('VOICE_ALLOWED_PLAYERS', 'MengMeng').split(',') if name.strip()}
# 误触门槛（2026-08-31 造物主谕「太短的当误触」）：实测 140 段——对讲机点一下
# 出 0.02~0.16s 垃圾段，真实最短指令「二」0.54s、「八号哎」0.62s，中间有干净
# 空档。取 0.45s：滤掉点触噪声，不误伤单字短指令；skip 打日志可追溯误删。
MIN_DUR_S = float(os.environ.get('ASR_MIN_DUR', '0.45'))
MAX_INPUT_AGE_MS = 120_000
MAX_DUR_S = 120
MAX_JOB_ID = 100
SEEN_LIMIT = 4096


def make_recognizer():
    if os.name != 'nt' and MODEL_DIR != '/model':
        raise RuntimeError('ASR_MODEL_DIR must identify the read-only /model mount')
    if not MODEL_DIR or not Path(MODEL_DIR).is_dir():
        raise RuntimeError('ASR model directory is missing')
    import sherpa_onnx
    return sherpa_onnx.OfflineRecognizer.from_paraformer(
        paraformer=os.path.join(MODEL_DIR, 'model.int8.onnx'),
        tokens=os.path.join(MODEL_DIR, 'tokens.txt'),
        num_threads=int(os.environ.get('ASR_THREADS', '2')),
        sample_rate=16000,
        feature_dim=80,
        decoding_method='greedy_search',
    )


def load_wav(path):
    import numpy as np
    with wave.open(path, 'rb') as w:
        assert w.getnchannels() == 1, 'mono only'
        assert w.getsampwidth() == 2, '16-bit only'
        sr = w.getframerate()
        data = w.readframes(w.getnframes())
    return sr, np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0


def transcribe(rec, wav_path):
    sr, samples = load_wav(wav_path)
    stream = rec.create_stream()
    stream.accept_waveform(sr, samples)
    rec.decode_stream(stream)
    return stream.result.text.strip()


# 单实例锁（2026-08-31，guard_drive 同款）：msvcrt 锁随进程退出自动释放。
# 注意容器（virtiofs）与宿主 NTFS 的锁互不可见——跨端并存靠下方 claim 认领兜底。
_LOCK_FH = None


def acquire_lock():
    global _LOCK_FH
    try:
        import msvcrt
    except ImportError:
        return True  # 非 Windows 由 claim 兜底
    try:
        _LOCK_FH = open(os.path.join(BASE, '.watcher.lock'), 'a+b')
        _LOCK_FH.seek(0)
        msvcrt.locking(_LOCK_FH.fileno(), msvcrt.LK_NBLCK, 1)
        return True
    except OSError:
        _LOCK_FH.close()
        _LOCK_FH = None
        return False


def claim(path):
    """原子认领：rename 进 processing/。抢到返回新路径，抢不到返回 None。
    多实例（含杀不掉的旧代码实例）并存时杜绝同段双转写双投递。"""
    tgt = os.path.join(PROCESSING, os.path.basename(path))
    if os.path.exists(tgt):
        return None
    try:
        os.rename(path, tgt)
        return tgt
    except OSError:
        return None


def archive(path):
    try:
        destination = Path(PROCESSED) / os.path.basename(path)
        if destination.exists():
            # Preserve the original archived evidence when a duplicate arrives.
            rejected = Path(PROCESSED) / 'duplicates'
            rejected.mkdir(exist_ok=True)
            destination = rejected / (str(time.time_ns()) + '-' + os.path.basename(path))
        os.replace(path, str(destination))
    except OSError:
        pass


def recording_metadata(value, now_ms):
    """Schema 2 contains packet bounds; schema 1 emission time cannot be upgraded."""
    if not isinstance(value, dict):
        raise ValueError('invalid_metadata')
    if type(value.get('schema')) is not int or value['schema'] != 2:
        raise ValueError('unsupported_recording_schema')
    player = value.get('player')
    if not isinstance(player, str) or player not in VOICE_ALLOWED_PLAYERS:
        raise ValueError('player_not_allowed')
    times = []
    for key in ('ts', 'recordingEndedAt', 'emittedAt'):
        stamp = value.get(key)
        if (isinstance(stamp, bool) or not isinstance(stamp, (int, float)) or
                stamp <= 0 or stamp > 9_007_199_254_740_991 or
                not math.isfinite(stamp) or int(stamp) != stamp):
            raise ValueError('invalid_recorded_at' if key == 'ts' else 'invalid_recording_interval')
        times.append(int(stamp))
    recorded_at, recording_ended_at, emitted_at = times
    if max(times) > now_ms:
        raise ValueError('future_recording')
    if recorded_at > recording_ended_at or recording_ended_at > emitted_at:
        raise ValueError('invalid_recording_interval')
    if now_ms - recorded_at > MAX_INPUT_AGE_MS:
        raise ValueError('stale_recording')
    return player, recorded_at, recording_ended_at, emitted_at


def seen_recordings():
    path = Path(BASE) / '.asr-seen.json'
    if not path.exists():
        return {}
    if path.stat().st_size > 1024 * 1024:
        raise ValueError('invalid_seen_history')
    data = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(data, dict) or len(data) > SEEN_LIMIT:
        raise ValueError('invalid_seen_history')
    if any(job_id(key) != key or not isinstance(value, int) or isinstance(value, bool)
           for key, value in data.items()):
        raise ValueError('invalid_seen_history')
    return data


def process_recording(rec, wav_path):
    """Process one actual queue job. Kept callable for offline queue/file tests."""
    source = Path(wav_path)
    if source.parent.resolve() != Path(INBOX).resolve() or source.is_symlink():
        return 'invalid_path'
    try:
        identifier = job_id(source.stem)
        if source.suffix != '.wav' or len(identifier) > MAX_JOB_ID:
            raise ValueError('invalid_filename')
    except ValueError:
        archive(str(source))
        return 'invalid_filename'
    # A seen ID is terminal even if world already consumed its outbox. Keep a
    # bounded recent index, with archived WAVs as the longer-lived replay guard.
    seen = seen_recordings()
    duplicate = identifier in seen or (Path(OUTBOX) / (identifier + '.json')).exists() or (Path(PROCESSED) / source.name).exists()
    claimed = claim(str(source))
    if claimed is None:
        return 'already_claimed'
    meta_src, meta = str(source.with_suffix('.txt')), str(Path(claimed).with_suffix('.txt'))
    if not os.path.isfile(meta_src) and not os.path.isfile(meta):
        time.sleep(0.2)
    if not os.path.isfile(meta_src) and not os.path.isfile(meta):
        # WAV and metadata are published separately by the current recorder.
        if time.time() - Path(claimed).stat().st_mtime < 5:
            os.rename(claimed, str(source))
            return 'metadata_pending'
        archive(claimed)
        return 'missing_metadata'
    if Path(meta_src).is_symlink() or Path(meta).is_symlink():
        archive(claimed)
        return 'invalid_metadata_path'
    if os.path.isfile(meta_src):
        try:
            os.rename(meta_src, meta)
        except OSError:
            archive(claimed)
            return 'metadata_claim_failed'

    def finish(code):
        archive(claimed)
        if meta and os.path.isfile(meta):
            archive(meta)
        return code

    if duplicate:
        return finish('duplicate_recording')
    try:
        if not meta or Path(meta).stat().st_size > 16_384:
            raise ValueError('invalid_metadata')
        value = json.loads(Path(meta).read_text(encoding='utf-8'))
        player, recorded_at, recording_ended_at, emitted_at = recording_metadata(value, int(time.time() * 1000))
        with wave.open(claimed, 'rb') as wav:
            dur = wav.getnframes() / wav.getframerate()
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2:
                raise ValueError('invalid_audio_format')
        if dur < MIN_DUR_S:
            return finish('short_recording')
        if dur > MAX_DUR_S:
            return finish('long_recording')
    except (ValueError, TypeError, OSError, wave.Error, ZeroDivisionError) as error:
        return finish(str(error) if isinstance(error, ValueError) and str(error) in {
            'invalid_metadata', 'player_not_allowed', 'invalid_recorded_at', 'future_recording',
            'stale_recording', 'invalid_audio_format', 'unsupported_recording_schema',
            'invalid_recording_interval'} else 'invalid_recording')
    try:
        text = transcribe(rec, claimed)
    except Exception:
        # Recognition can be retried while its ORIGINAL recording time is fresh.
        # Do not refresh metadata.ts when restoring a failed WAV to the inbox.
        os.rename(claimed, str(source))
        return 'asr_retry'
    completed_at = int(time.time() * 1000)
    seen[identifier] = completed_at
    seen = dict(sorted(seen.items(), key=lambda row: row[1])[-SEEN_LIMIT:])
    # Mark terminal before publication: a crash here may lose this transcription,
    # but must not replay a possible command by publishing the same ID again.
    atomic_json(Path(BASE) / '.asr-seen.json', seen)
    try:
        atomic_json(Path(OUTBOX) / (identifier + '.json'), {
            'schema': 2, 'id': identifier, 'player': player, 'text': text, 'ts': completed_at,
            'recordedAt': recorded_at, 'recordingEndedAt': recording_ended_at,
            'emittedAt': emitted_at, 'wav': source.name})
    except Exception:
        return finish('publication_uncertain')
    print('[asr]', player, '=>', text, f'({dur:.2f}s)', flush=True)
    return finish('published')


def main():
    os.makedirs(BASE, exist_ok=True)
    if not acquire_lock():
        print('[already-running] 另一实例持锁，本实例退出', flush=True)
        return
    for d in (INBOX, OUTBOX, PROCESSED, PROCESSING):
        os.makedirs(d, exist_ok=True)
    print('loading paraformer model ...', flush=True)
    rec = make_recognizer()
    print('mic asr watcher running, inbox =', INBOX, 'min_dur =', MIN_DUR_S, flush=True)
    while True:
        try:
            heartbeat(BASE, 'asr', state='polling', model_loaded=True)
            for w in sorted(glob.glob(os.path.join(INBOX, '*.wav'))):
                result = process_recording(rec, w)
                if result != 'published':
                    print('[asr-job]', os.path.basename(w), result, flush=True)
                if result == 'asr_retry':
                    time.sleep(3)
        except Exception as e:
            print('[loop-fail]', e, flush=True)
        # 幽灵 meta 清理：wav 被搬走而 meta 迟到的孤儿 txt，静置 60s+ 归档
        try:
            for mt in glob.glob(os.path.join(INBOX, '*.txt')):
                if not os.path.isfile(mt[:-4] + '.wav') and (time.time() - os.path.getmtime(mt)) > 60:
                    archive(mt)
            # processing/ 里超时 5 分钟的遗留（崩溃丢的）放回 inbox
            for pw in glob.glob(os.path.join(PROCESSING, '*.wav')):
                if time.time() - os.path.getmtime(pw) > 300:
                    try:
                        os.rename(pw, os.path.join(INBOX, os.path.basename(pw)))
                    except OSError:
                        pass
        except Exception as e:
            print('[sweep-fail]', e, flush=True)
        time.sleep(POLL)


if __name__ == '__main__':
    main()
