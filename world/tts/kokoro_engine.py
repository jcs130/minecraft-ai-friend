"""Offline Kokoro v1.1-zh bridge for the game's existing TTS adapter.

Reference WAV names are stable character aliases, not voice-cloning inputs.
Only explicitly installed model/config/voice files are used. English G2P uses
Misaki's local small spaCy package and eSpeak fallback; no language model runs.
"""
from __future__ import annotations

import math
import os
from pathlib import Path
import re
import wave


REPO_ID = "hexgrad/Kokoro-82M-v1.1-zh"
SAMPLE_RATE = 24000


class UnsupportedSynthesisOption(ValueError):
    """The requested capability is not provided by the installed synthesizer."""


class KokoroEngine:
    engine_name = "Kokoro-82M-v1.1-zh"
    qwen_emo = None
    supports_emotion = False
    sample_rate = SAMPLE_RATE

    def __init__(self, model_dir: str | Path, voice_mappings: dict[str, str],
                 device: str = "cuda:0", max_phonemes: int = 180):
        root = Path(model_dir).resolve(strict=True)
        config_path = self._local_file(root, "config.json")
        weights_path = self._local_file(root, "kokoro-v1_1-zh.pth")
        if not isinstance(voice_mappings, dict) or not voice_mappings:
            raise ValueError("At least one explicit character voice mapping is required")
        self.voiceMappings = dict(voice_mappings)
        if any(not isinstance(alias, str) or not alias.strip() or
               not isinstance(voice, str) or not re.fullmatch(r"[a-z][a-z0-9_]*", voice)
               for alias, voice in self.voiceMappings.items()):
            raise ValueError("Invalid character voice mapping")
        voice_paths = {
            voice: self._local_file(root, f"voices/{voice}.pt")
            for voice in sorted(set(self.voiceMappings.values()))
        }
        if isinstance(max_phonemes, bool) or not isinstance(max_phonemes, int) or not 20 <= max_phonemes <= 510:
            raise ValueError("max_phonemes must be an integer between 20 and 510")
        if not isinstance(device, str) or not re.fullmatch(r"cpu|cuda(?::[0-9]+)?", device):
            raise ValueError("device must explicitly select cpu or cuda")

        # Set these before importing the libraries. Explicit file arguments and
        # the package precheck below also prevent lazy download code paths.
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        import spacy
        if not spacy.util.is_package("en_core_web_sm"):
            raise RuntimeError("Install en_core_web_sm in the TTS image before startup; runtime downloads are disabled")
        import torch
        from kokoro import KModel, KPipeline

        if device.startswith("cuda") and not torch.cuda.is_available():
            raise RuntimeError("Kokoro CUDA was requested but is unavailable")
        self._torch = torch
        self.model = KModel(repo_id=REPO_ID, config=str(config_path), model=str(weights_path)).to(device).eval()
        self.device = str(self.model.device)
        self.max_phonemes = min(max_phonemes, int(self.model.context_length) - 2)

        # The quiet English pipeline only computes pronunciation. It shares no
        # voice, loads no second speech model, and consumes all English chunks.
        self.english_pipeline = KPipeline(lang_code="a", repo_id=REPO_ID, model=False, trf=False)
        if self.english_pipeline.g2p.fallback is None:
            raise RuntimeError("Kokoro requires the local eSpeak English fallback for mixed Chinese/English text")
        self.pipeline = KPipeline(lang_code="z", repo_id=REPO_ID, model=self.model,
                                  en_callable=self._english_phonemes)
        for voice, path in voice_paths.items():
            pack = torch.load(str(path), map_location="cpu", weights_only=True)
            if len(pack) < self.max_phonemes:
                raise ValueError("Installed voice pack is shorter than the configured phoneme window")
            self.pipeline.voices[voice] = pack
        self.available_voices = sorted(voice_paths)

    @staticmethod
    def _local_file(root: Path, relative: str) -> Path:
        path = (root / relative).resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("Kokoro assets must be files inside the configured model directory")
        return path

    def resolve_voice(self, reference: str) -> str:
        if not isinstance(reference, str) or not reference.strip():
            raise ValueError("A character voice alias is required")
        # Keep compatibility with callers that send the previous WAV path.
        name = reference.replace("\\", "/").rsplit("/", 1)[-1]
        if name.lower().endswith((".wav", ".mp3", ".pt")):
            name = name.rsplit(".", 1)[0]
        voice = self.voiceMappings.get(name, name)
        if voice not in self.available_voices:
            raise ValueError("Character voice is not mapped to an installed Kokoro voice")
        return voice

    def _english_phonemes(self, text: str) -> str:
        phonemes = " ".join(result.phonemes for result in self.english_pipeline(text) if result.phonemes)
        if text.strip() and not phonemes:
            raise ValueError("English text produced no pronunciation")
        return phonemes

    def _phoneme_chunks(self, text: str):
        """Bound actual phoneme length before Kokoro 0.9.4 can truncate it.

        Its non-English __call__ implementation splits by character count and
        silently clips at 510 phonemes. Using G2P + generate_from_tokens avoids
        that loss. Split text (not phonemes) to retain tone/word boundaries.
        """
        for sentence in re.split(r"(?<=[。！？.!?；;\n])", text):
            if sentence.strip():
                yield from self._split_sentence(sentence.strip())

    def _split_sentence(self, text: str):
        phonemes, _ = self.pipeline.g2p(text)
        if not phonemes:
            raise ValueError("Text produced no pronunciation")
        if len(phonemes) <= self.max_phonemes:
            yield phonemes
            return
        if len(text) <= 1:
            raise ValueError("One text character exceeds the phoneme window")
        midpoint = len(text) // 2
        boundaries = [match.end() for match in re.finditer(r"[,，、：:\s]+", text)
                      if 0 < match.end() < len(text)]
        cut = min(boundaries, key=lambda index: abs(index - midpoint)) if boundaries else midpoint
        for part in (text[:cut].strip(), text[cut:].strip()):
            if part:
                yield from self._split_sentence(part)

    def infer(self, *, spk_audio_prompt: str, text: str, output_path: str,
              lang: str = "ZH", duration_factor: float = 1.0, verbose: bool = False,
              emo_vector=None, emo_alpha: float = 1.0, emo_text=None,
              emo_audio_prompt=None, use_emo_text: bool = False, **options) -> str:
        neutral_vector = (emo_vector is None or
                          isinstance(emo_vector, (list, tuple)) and len(emo_vector) == 8 and
                          all(isinstance(value, (int, float)) and value == 0 for value in emo_vector))
        if (not neutral_vector or emo_text or emo_audio_prompt or use_emo_text):
            raise UnsupportedSynthesisOption("Kokoro does not support IndexTTS emotion or reference-audio conditioning")
        if options:
            raise UnsupportedSynthesisOption("Unsupported Kokoro synthesis option")
        if not isinstance(lang, str) or lang.lower() not in {
                "zh", "zh-cn", "zh_cn", "chinese", "中文", "z",
                "en", "en-us", "en_us", "english", "a", "auto"}:
            raise UnsupportedSynthesisOption("Installed Kokoro model supports Chinese and English")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Text must not be empty")
        if (isinstance(duration_factor, bool) or not isinstance(duration_factor, (int, float))
                or not math.isfinite(duration_factor) or not 0.5 <= duration_factor <= 2.0):
            raise ValueError("duration_factor must be finite and between 0.5 and 2.0")
        voice = self.resolve_voice(spk_audio_prompt)
        # Legacy duration_factor multiplies duration; Kokoro speed divides it.
        speed = 1.0 / duration_factor
        import numpy as np

        audio_chunks = []
        with self._torch.inference_mode():
            for phonemes in self._phoneme_chunks(text):
                for result in self.pipeline.generate_from_tokens(phonemes, voice=voice, speed=speed):
                    if result.audio is None:
                        raise RuntimeError("Kokoro returned a chunk without audio")
                    audio = result.audio.detach().cpu().numpy().reshape(-1)
                    if not audio.size or not np.isfinite(audio).all():
                        raise RuntimeError("Kokoro returned invalid audio")
                    audio_chunks.append(audio)
        if not audio_chunks:
            raise RuntimeError("Kokoro returned no audio")
        samples = np.concatenate(audio_chunks)
        pcm = np.rint(np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
        with wave.open(str(output_path), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(SAMPLE_RATE)
            output.writeframes(pcm.tobytes())
        return str(output_path)
