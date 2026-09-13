"""Exercise adapter boundaries without model weights, downloads or playback."""
import contextlib
import importlib.util
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import Mock, patch
import wave

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("qd_kokoro_engine", ROOT / "world/tts/kokoro_engine.py")
engine_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine_module)


class FakeAudio:
    def __init__(self, values):
        self.values = np.asarray(values, dtype=np.float32)

    def detach(self):
        return self

    def cpu(self):
        return self

    def numpy(self):
        return self.values


class KokoroEngineTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="qd-kokoro-engine-")
        self.root = Path(self.directory.name)
        (self.root / "voices").mkdir()
        for name in ("config.json", "kokoro-v1_1-zh.pth", "voices/zf_001.pt", "voices/zm_010.pt"):
            (self.root / name).write_bytes(b"fixture")
        self.model_calls = []
        self.pipeline_calls = []
        self.generated = []
        self.english_calls = []
        test = self

        class FakeModel:
            context_length = 512

            def __init__(self, **kwargs):
                test.model_calls.append(kwargs)
                # Omitting either path would activate HF downloads in KModel.
                assert Path(kwargs["config"]).is_file()
                assert Path(kwargs["model"]).is_file()
                assert os.environ["HF_HUB_OFFLINE"] == "1"

            def to(self, device):
                self.device = device
                return self

            def eval(self):
                return self

        class FakePipeline:
            def __init__(self, **kwargs):
                test.pipeline_calls.append(kwargs)
                self.voices = {}
                self.lang_code = kwargs["lang_code"]
                self.en_callable = kwargs.get("en_callable")
                if self.lang_code == "a":
                    assert kwargs["model"] is False
                    self.g2p = types.SimpleNamespace(fallback=object())
                else:
                    self.g2p = lambda text: ("".join(character * 4 for character in text), None)

            def __call__(self, text):
                assert self.lang_code == "a"
                test.english_calls.append(text)
                yield types.SimpleNamespace(phonemes="hello")
                yield types.SimpleNamespace(phonemes="world")

            def generate_from_tokens(self, phonemes, *, voice, speed):
                # A cache miss would try to fetch a voice from Hugging Face.
                assert voice in self.voices
                test.generated.append((phonemes, voice, speed))
                yield types.SimpleNamespace(audio=FakeAudio([0.25, -0.25]))
                yield types.SimpleNamespace(audio=FakeAudio([0.5, -0.5, 0]))

        self.spacy = types.SimpleNamespace(util=types.SimpleNamespace(is_package=Mock(return_value=True)),
                                           cli=types.SimpleNamespace(download=Mock(side_effect=AssertionError("No downloads"))))
        self.torch = types.SimpleNamespace(
            cuda=types.SimpleNamespace(is_available=Mock(return_value=True)),
            load=Mock(return_value=[0] * 510), inference_mode=contextlib.nullcontext)
        self.modules = patch.dict("sys.modules", {
            "spacy": self.spacy, "torch": self.torch,
            "kokoro": types.SimpleNamespace(KModel=FakeModel, KPipeline=FakePipeline),
            "huggingface_hub": types.SimpleNamespace(hf_hub_download=Mock(side_effect=AssertionError("No downloads"))),
        })
        self.modules.start()
        self.environment = patch.dict(os.environ)
        self.environment.start()
        self.mapping = {"goddess": "zf_001", "yui": "zf_001", "kirito": "zm_010"}

    def tearDown(self):
        self.environment.stop()
        self.modules.stop()
        self.directory.cleanup()

    def engine(self, **kwargs):
        return engine_module.KokoroEngine(self.root, self.mapping, **kwargs)

    def test_explicit_local_assets_are_loaded_once_and_aliases_use_real_voices(self):
        engine = self.engine()
        self.assertEqual(len(self.model_calls), 1)
        self.assertEqual(self.model_calls[0]["repo_id"], engine_module.REPO_ID)
        self.assertEqual(engine.device, "cuda:0")
        self.assertIsNone(engine.qwen_emo)
        self.assertEqual(engine.resolve_voice(r"C:\old\voices\kirito.wav"), "zm_010")
        self.assertEqual(engine.resolve_voice("/voices/yui.wav"), "zf_001")
        self.assertEqual(self.torch.load.call_count, 2)
        for call in self.torch.load.call_args_list:
            self.assertEqual(call.kwargs, {"map_location": "cpu", "weights_only": True})
        self.spacy.cli.download.assert_not_called()

    def test_long_text_and_every_generated_audio_chunk_are_preserved_in_pcm_wav(self):
        engine = self.engine(max_phonemes=180)
        text = "树" * 600 + "。"
        output = self.root / "complete.wav"
        engine.infer(spk_audio_prompt="kirito", text=text, output_path=str(output), duration_factor=2.0)
        self.assertGreater(len(self.generated), 1)
        self.assertEqual("".join(call[0] for call in self.generated), "".join(char * 4 for char in text))
        self.assertTrue(all(len(phonemes) <= 180 and voice == "zm_010" and speed == 0.5
                            for phonemes, voice, speed in self.generated))
        with wave.open(str(output), "rb") as stream:
            self.assertEqual((stream.getframerate(), stream.getnchannels(), stream.getsampwidth()), (24000, 1, 2))
            self.assertEqual(stream.getnframes(), len(self.generated) * 5)
            samples = np.frombuffer(stream.readframes(stream.getnframes()), dtype="<i2")
            np.testing.assert_array_equal(samples[:5], [8192, -8192, 16384, -16384, 0])

    def test_chinese_pipeline_receives_complete_english_pronunciation_without_second_model(self):
        engine = self.engine()
        chinese = self.pipeline_calls[-1]
        self.assertEqual(chinese["lang_code"], "z")
        self.assertEqual(chinese["repo_id"], "hexgrad/Kokoro-82M-v1.1-zh")
        self.assertIs(chinese["model"], engine.model)
        self.assertEqual(chinese["en_callable"]("hello world"), "hello world")
        self.assertEqual(self.english_calls, ["hello world"])
        self.assertEqual(len(self.model_calls), 1)

    def test_missing_english_package_or_model_fails_without_trying_a_download(self):
        self.spacy.util.is_package.return_value = False
        with self.assertRaisesRegex(RuntimeError, "en_core_web_sm"):
            self.engine()
        self.assertEqual(self.model_calls, [])
        self.spacy.cli.download.assert_not_called()
        (self.root / "config.json").unlink()
        with self.assertRaises(FileNotFoundError):
            self.engine()
        self.assertEqual(self.model_calls, [])

    def test_cuda_request_does_not_silently_fall_back_to_cpu(self):
        self.torch.cuda.is_available.return_value = False
        with self.assertRaisesRegex(RuntimeError, "CUDA"):
            self.engine()
        self.assertEqual(self.model_calls, [])

    def test_unsupported_voice_emotion_and_language_do_not_produce_audio(self):
        engine = self.engine()
        output = self.root / "never.wav"
        base = dict(spk_audio_prompt="goddess", text="测试", output_path=str(output))
        for extra in ({"spk_audio_prompt": "unknown.wav"}, {"emo_vector": [1] + [0] * 7},
                      {"emo_text": "happy"}, {"lang": "JA"}, {"duration_factor": float("nan")}):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                engine.infer(**{**base, **extra})
        self.assertEqual(self.generated, [])
        self.assertFalse(output.exists())
        engine.infer(**base, emo_vector=[0] * 8)
        self.assertTrue(output.exists())


if __name__ == "__main__":
    unittest.main()
