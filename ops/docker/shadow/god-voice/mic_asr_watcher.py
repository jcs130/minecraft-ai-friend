# -*- coding: utf-8 -*-
"""天耳 ASR 管线（本地 sherpa-onnx paraformer-small 版）：
mic/inbox/*.wav -> 误触/白名单过滤 -> ASR 转写 -> mic/outbox/*.json。
女神 bot（world/mc-god.ts）消费 outbox 把转写当发言处理。wav 移入 processed 留档。
2026-08-31 进程收编 docker：本文件即 shadow-asr 容器主程序（compose 见 ../docker-compose.yml）；
宿主直跑仅渡备用，路径 env 化（MIC_BASE/ASR_MODEL_DIR）。
"""
import json, os, time, glob, wave

import numpy as np
import sherpa_onnx

# 路径参数化：容器注入 env；无 env 回退宿主路径
BASE = os.environ.get(
    'MIC_BASE',
    r'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\mc\data\godvoice\mic',
)
INBOX = os.path.join(BASE, 'inbox')
OUTBOX = os.path.join(BASE, 'outbox')
PROCESSED = os.path.join(BASE, 'processed')
PROCESSING = os.path.join(BASE, 'processing')
MODEL_DIR = os.environ.get(
    'ASR_MODEL_DIR',
    r'C:\Users\lzl19\.copaw\workspaces\mc-god\sherpa-onnx-paraformer-zh-small-2024-03-09',
)
POLL = 1.0
# 语音回应白名单（2026-08-30 造物主定）：只有萌萌的游戏内语音会被转写并投递给女神；
# 其他玩家的语音段直接归档，不转写、不回应。
VOICE_ALLOWED_PLAYERS = {'MengMeng'}
# 误触门槛（2026-08-31 造物主谕「太短的当误触」）：实测 140 段——对讲机点一下
# 出 0.02~0.16s 垃圾段，真实最短指令「二」0.54s、「八号哎」0.62s，中间有干净
# 空档。取 0.45s：滤掉点触噪声，不误伤单字短指令；skip 打日志可追溯误删。
MIN_DUR_S = float(os.environ.get('ASR_MIN_DUR', '0.45'))


def make_recognizer():
    return sherpa_onnx.OfflineRecognizer.from_paraformer(
        paraformer=os.path.join(MODEL_DIR, 'model.int8.onnx'),
        tokens=os.path.join(MODEL_DIR, 'tokens.txt'),
        num_threads=2,
        sample_rate=16000,
        feature_dim=80,
        decoding_method='greedy_search',
    )


def load_wav(path):
    with wave.open(path, 'rb') as w:
        assert w.getnchannels() == 1, 'mono only'
        assert w.getsampwidth() == 2, '16-bit only'
        sr = w.getframerate()
        data = w.readframes(w.getnframes())
    return sr, np.frombuffer(data, dtype=np.int16)


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
    try:
        os.rename(path, tgt)
        return tgt
    except OSError:
        return None


def archive(path):
    try:
        os.replace(path, os.path.join(PROCESSED, os.path.basename(path)))
    except OSError:
        pass


def main():
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
            for w in sorted(glob.glob(os.path.join(INBOX, '*.wav'))):
                name = os.path.basename(w)
                claimed = claim(w)
                if claimed is None:
                    continue  # 别的实例已认领
                # MicCapture 先落 wav 后落 meta；meta 若已至则随段认领
                meta_src = w[:-4] + '.txt'
                meta = claimed[:-4] + '.txt'
                player = 'MengMeng'
                if os.path.isfile(meta_src):
                    try:
                        os.rename(meta_src, meta)
                    except OSError:
                        meta = None
                if meta and os.path.isfile(meta):
                    try:
                        player = json.load(open(meta, encoding='utf-8')).get('player', 'MengMeng')
                    except Exception:
                        pass
                if player not in VOICE_ALLOWED_PLAYERS:
                    print('[skip-nonVIP]', player, name, flush=True)
                    archive(claimed)
                    if meta:
                        archive(meta)
                    continue
                dur = (os.path.getsize(claimed) - 44) / (16000 * 2)
                if dur < MIN_DUR_S:
                    print('[skip-short]', player, f'{dur:.2f}s', name, flush=True)
                    archive(claimed)
                    if meta:
                        archive(meta)
                    continue
                try:
                    text = transcribe(rec, claimed)
                    ts = int(time.time() * 1000)
                    out = os.path.join(OUTBOX, '%d.json' % ts)
                    with open(out, 'w', encoding='utf-8') as f:
                        json.dump({'player': player, 'text': text, 'ts': ts, 'wav': name},
                                  f, ensure_ascii=False)
                    print('[asr]', player, '=>', text, f'({dur:.2f}s)', flush=True)
                    archive(claimed)
                    if meta:
                        archive(meta)
                except Exception as e:
                    print('[asr-fail]', name, e, flush=True)
                    try:  # 失败放回 inbox 下轮重试，不留尸 processing
                        os.rename(claimed, w)
                    except OSError:
                        pass
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
