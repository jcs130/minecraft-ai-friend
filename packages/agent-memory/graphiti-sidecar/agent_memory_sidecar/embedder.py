"""Deterministic local embedder: no network, no key. Hashes word tokens and CJK bigrams into a signed vector.

It gives lexical-overlap similarity only (no semantics). It exists so Graphiti can run where no embedding API is
available (e.g. DeepSeek has chat but no embeddings endpoint). Swap to `AGENT_MEMORY_EMBEDDER=openai` for real
semantic vectors.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections.abc import Iterable

from graphiti_core.embedder.client import EmbedderClient

_WORD = re.compile(r"[a-z0-9_:.\-]+")
_CJK = re.compile(r"[\u3400-\u9fff]+")


def features(text: str) -> list[str]:
    lower = text.lower()
    feats = _WORD.findall(lower)
    for run in _CJK.findall(lower):
        feats.extend(run if len(run) == 1 else [run[i:i + 2] for i in range(len(run) - 1)])
    return feats


def hash_embed(text: str, dim: int) -> list[float]:
    vec = [0.0] * dim
    for feat in features(text):
        digest = hashlib.blake2b(feat.encode("utf-8"), digest_size=8).digest()
        idx = int.from_bytes(digest[:4], "little") % dim
        vec[idx] += 1.0 if digest[4] & 1 else -1.0
    norm = math.sqrt(sum(v * v for v in vec))
    if norm == 0:
        vec[0] = 1.0
        return vec
    return [v / norm for v in vec]


class HashEmbedder(EmbedderClient):
    def __init__(self, dim: int = 384):
        self.dim = dim

    async def create(self, input_data: str | list[str] | Iterable[int] | Iterable[Iterable[int]]) -> list[float]:
        if isinstance(input_data, str):
            return hash_embed(input_data, self.dim)
        if isinstance(input_data, list) and input_data and isinstance(input_data[0], str):
            return hash_embed(" ".join(input_data), self.dim)  # type: ignore[arg-type]
        return hash_embed(str(input_data), self.dim)

    async def create_batch(self, input_data_list: list[str]) -> list[list[float]]:
        return [hash_embed(t, self.dim) for t in input_data_list]
