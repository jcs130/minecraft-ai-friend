# -*- coding: utf-8 -*-
"""
瓶中轻量 embedding 服务（假 ollama 协议）
- 后端：fastembed (ONNX Runtime CPU)，默认 intfloat/multilingual-e5-large（1024d，多语言）
- 对外：ollama /api/embed + /api/tags 接口 —— 众生册(mc-worlddb.ts 硬编码 /api/embed) 与
  MemOS(ollama embedder) 零改动直连
- 云端预案：设 EMBED_OPENAI_BASE_URL 时走 OpenAI 兼容 /embeddings（dashscope/硅基流动），
  本地 ONNX 完全不用（镜像无需烧模型，适合纯 CPU 云机）
"""
import os
import sys
import time

from fastapi import FastAPI
from pydantic import BaseModel

MODEL_NAME = os.environ.get("EMBED_MODEL", "intfloat/multilingual-e5-large")
CLOUD_BASE = os.environ.get("EMBED_OPENAI_BASE_URL", "")  # 例 https://dashscope.aliyuncs.com/compatible-mode/v1
CLOUD_MODEL = os.environ.get("EMBED_OPENAI_MODEL", "")
CLOUD_KEY = os.environ.get("EMBED_OPENAI_API_KEY", "")

app = FastAPI()
_t0 = time.time()
_backend = None
_dim = None


def backend():
    global _backend, _dim
    if _backend is not None:
        return _backend
    if CLOUD_BASE:
        import urllib.request
        import json as _json

        class Cloud:
            def embed(self, texts):
                req = urllib.request.Request(
                    CLOUD_BASE.rstrip("/") + "/embeddings",
                    data=_json.dumps({"model": CLOUD_MODEL, "input": texts}).encode(),
                    headers={"Content-Type": "application/json", "Authorization": f"Bearer {CLOUD_KEY}"},
                )
                data = _json.loads(urllib.request.urlopen(req, timeout=60).read())
                return [d["embedding"] for d in data["data"]]

            @property
            def dim(self):
                return len(self.embed(["探测"])[0])

        _backend = Cloud()
    else:
        from fastembed import TextEmbedding

        cache = os.environ.get("FASTEMBED_CACHE", "/data/fastembed")
        emb = TextEmbedding(model_name=MODEL_NAME, cache_dir=cache,
                            threads=int(os.environ.get("EMBED_THREADS", "0") or 0))
        _backend = type("Local", (), {
            "embed": lambda _, texts: [list(map(float, v)) for v in emb.embed(texts)],
            "dim": len(list(emb.embed(["探测"]))[0]),
        })()
    _dim = _backend.dim
    print(f"[embed] backend ready: {'cloud:' + CLOUD_MODEL if CLOUD_BASE else MODEL_NAME} dim={_dim} "
          f"({time.time() - _t0:.1f}s)", flush=True)
    return _backend


class EmbedReq(BaseModel):
    model: str = ""
    input: object = None  # str 或 [str]


@app.post("/api/embed")
def api_embed(req: EmbedReq):
    texts = req.input if isinstance(req.input, list) else [req.input]
    vecs = backend().embed(texts)
    return {"model": req.model or MODEL_NAME, "embeddings": vecs}


@app.get("/api/tags")
def api_tags():
    return {"models": [{"name": MODEL_NAME, "model": MODEL_NAME}]}


@app.get("/api/show")
def api_show():
    return {"modelfile": f"FROM {MODEL_NAME}", "parameters": {}}


@app.get("/health")
def health():
    try:
        b = backend()
        return {"status": "ok", "model": MODEL_NAME, "dim": _dim, "mode": "cloud" if CLOUD_BASE else "local"}
    except Exception as e:
        return {"status": "loading", "error": str(e)[:200]}
