"""Read-only CPU ASR check using the supplied model's own sample recording."""
import json
import time
import wave
from pathlib import Path
import numpy as np
import sherpa_onnx

model = Path('/model')
started = time.monotonic()
recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
    paraformer=str(model / 'model.int8.onnx'), tokens=str(model / 'tokens.txt'),
    num_threads=2, sample_rate=16000, feature_dim=80, decoding_method='greedy_search')
with wave.open(str(model / 'test_wavs/0.wav'), 'rb') as recording:
    assert recording.getnchannels() == 1 and recording.getsampwidth() == 2
    rate = recording.getframerate()
    samples = np.frombuffer(recording.readframes(recording.getnframes()), dtype=np.int16).astype(np.float32) / 32768
stream = recognizer.create_stream()
stream.accept_waveform(rate, samples)
recognizer.decode_stream(stream)
text = stream.result.text.strip()
assert text, 'The existing ASR model produced empty recognition'
print(json.dumps({'ok': True, 'sherpaOnnx': sherpa_onnx.__version__, 'text': text,
                  'audioSeconds': len(samples) / rate, 'elapsedSeconds': round(time.monotonic() - started, 3)}, ensure_ascii=False))
