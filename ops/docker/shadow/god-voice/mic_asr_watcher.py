# -*- coding: utf-8 -*-
"""天耳 ASR 管线（本地 sherpa-onnx paraformer-small 版）：
mic/inbox/*.wav -> 本地 ASR 转写 -> mic/outbox/*.json。
女神 bot 消费 outbox 把转写当萌萌发言处理。wav 移入 processed 留档。
用法: python mic_asr_watcher.py   (常驻)
"""
import json, os, shutil, time, glob, sys, wave

import numpy as np
import sherpa_onnx

BASE = r'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\mc\data\godvoice\mic'
INBOX = os.path.join(BASE, 'inbox')
OUTBOX = os.path.join(BASE, 'outbox')
PROCESSED = os.path.join(BASE, 'processed')
MODEL_DIR = r'C:\Users\lzl19\.copaw\workspaces\mc-god\sherpa-onnx-paraformer-zh-small-2024-03-09'
POLL = 1.0
# 语音回应白名单（2026-08-30 造物主定）：只有萌萌的游戏内语音会被转写并投递给女神；
# 其他玩家的语音段直接归档，不转写、不回应。
VOICE_ALLOWED_PLAYERS = {'MengMeng'}


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
    # paraformer 支持 16k 之外的重采样，这里 MicCapture 出的就是 16k
    stream = rec.create_stream()
    stream.accept_waveform(sr, samples)
    rec.decode_stream(stream)
    return stream.result.text.strip()


# 单实例锁（2026-08-31，guard_drive 同款方案）：多轮手工重拉曾致 2-3 个 watcher
# 并存争抢 inbox 文件。msvcrt 区域锁随进程退出自动释放——死了不残锁，双开即退出。
_LOCK_FH = None


def acquire_lock():
    global _LOCK_FH
    try:
        import msvcrt
    except ImportError:
        return True  # 非 Windows 不设防
    _LOCK_FH = open(os.path.join(BASE, '.watcher.lock'), 'a+b')
    try:
        _LOCK_FH.seek(0)
        msvcrt.locking(_LOCK_FH.fileno(), msvcrt.LK_NBLCK, 1)
        return True
    except OSError:
        _LOCK_FH.close()
        _LOCK_FH = None
        return False


def main():
    if not acquire_lock():
        print('[already-running] 另一实例持锁，本实例退出', flush=True)
        return
    for d in (INBOX, OUTBOX, PROCESSED):
        os.makedirs(d, exist_ok=True)
    print('loading paraformer model ...', flush=True)
    rec = make_recognizer()
    print('mic asr watcher (sherpa-onnx local) running, inbox =', INBOX, flush=True)
    while True:
        try:
            wavs = sorted(glob.glob(os.path.join(INBOX, '*.wav')))
            for w in wavs:
                meta = w[:-4] + '.txt'
                player = 'MengMeng'
                if os.path.isfile(meta):
                    try:
                        player = json.load(open(meta, encoding='utf-8')).get('player', 'MengMeng')
                    except Exception:
                        pass
                # 白名单外的玩家语音：直接归档，不转写不投递
                if player not in VOICE_ALLOWED_PLAYERS:
                    print('[skip-nonVIP]', player, os.path.basename(w), flush=True)
                    os.replace(w, os.path.join(PROCESSED, os.path.basename(w)))
                    if os.path.isfile(meta):
                        os.replace(meta, os.path.join(PROCESSED, os.path.basename(meta)))
                    continue
                # 误触过滤（2026-08-31 造物主谕「太短的当误触」）：对讲机点一下
                # 出的是 0.02~0.16s 的极短垃圾段（下午 140 段实测：误触 <0.2s、
                # 真实最短指令「二」0.54s、「八号哎」0.62s，中间有干净空档）。
                # 门槛抬到 0.45s：滤掉所有点触噪声，又绝不误伤单字短指令。
                dur = (os.path.getsize(w) - 44) / (16000 * 2)
                if dur < 0.45:
                    print('[skip-short]', player, f'{dur:.2f}s', os.path.basename(w), flush=True)
                    os.replace(w, os.path.join(PROCESSED, os.path.basename(w)))
                    if os.path.isfile(meta):
                        os.replace(meta, os.path.join(PROCESSED, os.path.basename(meta)))
                    continue
                try:
                    text = transcribe(rec, w)
                    ts = int(time.time() * 1000)
                    out = os.path.join(OUTBOX, '%d.json' % ts)
                    with open(out, 'w', encoding='utf-8') as f:
                        json.dump({'player': player, 'text': text, 'ts': ts, 'wav': os.path.basename(w)}, f, ensure_ascii=False)
                    print('[asr]', player, '=>', text, flush=True)
                    os.replace(w, os.path.join(PROCESSED, os.path.basename(w)))
                    if os.path.isfile(meta):
                        os.replace(meta, os.path.join(PROCESSED, os.path.basename(meta)))
                except Exception as e:
                    print('[asr-fail]', os.path.basename(w), e, flush=True)
                    time.sleep(3)
        except Exception as e:
            print('[loop-fail]', e, flush=True)
        # 幽灵 meta 清理（2026-08-31）：MicCapture 先落 wav 后落 meta，watcher 抢在
        # meta 落盘前转完并搬走 wav → meta 成孤儿留在 inbox（曾积 98 个）。
        # 凡 inbox 里 txt 无同名 wav 且已静置 60s+ → 移入 processed 归档。
        try:
            import time as _t
            for mt in glob.glob(os.path.join(INBOX, '*.txt')):
                wav = mt[:-4] + '.wav'
                if not os.path.isfile(wav) and (_t.time() - os.path.getmtime(mt)) > 60:
                    os.replace(mt, os.path.join(PROCESSED, os.path.basename(mt)))
        except Exception as e:
            print('[meta-sweep-fail]', e, flush=True)
        time.sleep(POLL)


if __name__ == '__main__':
    main()
