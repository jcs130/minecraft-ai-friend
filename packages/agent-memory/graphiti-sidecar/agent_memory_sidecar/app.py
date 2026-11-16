"""HTTP surface (loopback by default). Protocol: agent-mc-memory-graph/v1.

GET  /health
POST /episodes  {protocol, group_id, episode:{id,kind,name,body,source_description,reference_time,actors}, hints:[str]}
POST /search    {protocol, group_id, query, limit, at?, known_at?, history?}
"""

from __future__ import annotations

import hmac
import re
from datetime import datetime
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from . import PROTOCOL
from .service import EpisodeIn, GraphService

_GROUP = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class _Base(BaseModel):
    protocol: str = PROTOCOL
    group_id: str

    @field_validator("protocol")
    @classmethod
    def _protocol(cls, v: str) -> str:
        if v != PROTOCOL:
            raise ValueError(f"unsupported protocol {v}")
        return v

    @field_validator("group_id")
    @classmethod
    def _group(cls, v: str) -> str:
        if not _GROUP.match(v):
            raise ValueError("group_id must be 1-64 chars of [A-Za-z0-9_-]")
        return v


class EpisodeRequest(_Base):
    episode: EpisodeIn
    hints: list[str] = Field(default_factory=list, max_length=50)


class SearchRequest(_Base):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=20, ge=1, le=100)
    at: datetime | None = None
    known_at: datetime | None = None
    history: bool = False


def create_app(service: GraphService, token: str | None = None) -> FastAPI:
    app = FastAPI(title="agent-mc-memory graphiti sidecar", version="0.1.0")

    @app.middleware("http")
    async def auth(request: Request, call_next):  # type: ignore[no-untyped-def]
        if token:
            given = request.headers.get("authorization", "")
            if not hmac.compare_digest(given, f"Bearer {token}"):
                from fastapi.responses import JSONResponse
                return JSONResponse({"detail": "unauthorized"}, status_code=401)
        return await call_next(request)

    @app.get("/health")
    async def health() -> dict[str, Any]:
        try:
            return await service.health()
        except Exception as error:  # noqa: BLE001 - surface as unhealthy, never leak config
            return {"ok": False, "error": type(error).__name__}

    @app.post("/episodes")
    async def episodes(req: EpisodeRequest) -> dict[str, Any]:
        try:
            return await service.add_episode(req.group_id, req.episode, req.hints)
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)[:300]) from error

    @app.post("/search")
    async def search(req: SearchRequest) -> dict[str, Any]:
        facts = await service.search(req.group_id, req.query, req.limit, req.at, req.known_at, req.history)
        return {"facts": facts}

    return app
