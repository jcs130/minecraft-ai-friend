"""Environment configuration. Secrets are referenced by *environment variable name* and never stored or printed."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

_ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _env_name(value: str | None, default: str) -> str:
    name = (value or default).strip()
    if not _ENV_NAME.match(name):
        raise ValueError("API key setting must be an environment variable NAME, not a key")
    return name


@dataclass(frozen=True)
class LLMSettings:
    base_url: str | None
    model: str | None
    small_model: str | None
    api_key_env: str
    structured_output: str  # json_schema | json_object

    @property
    def configured(self) -> bool:
        return bool(self.model) and bool(os.environ.get(self.api_key_env))

    def describe(self) -> str:
        host = re.sub(r"^https?://([^/]+).*$", r"\1", self.base_url or "default")
        return f"{self.model or 'unset'}@{host}" + ("" if self.configured else " (no key)")


@dataclass(frozen=True)
class EmbedderSettings:
    kind: str  # hash | openai
    base_url: str | None
    model: str | None
    api_key_env: str
    dim: int

    def describe(self) -> str:
        return f"hash-{self.dim}" if self.kind == "hash" else f"{self.model}-{self.dim}"


@dataclass(frozen=True)
class Settings:
    driver: str  # kuzu | falkordb
    kuzu_path: str
    falkordb_host: str
    falkordb_port: int
    host: str
    port: int
    token_env: str | None
    llm: LLMSettings
    embedder: EmbedderSettings
    extra: dict[str, str] = field(default_factory=dict)

    def token(self) -> str | None:
        return os.environ.get(self.token_env) if self.token_env else None


def load_settings(env: dict[str, str] | None = None) -> Settings:
    e = os.environ if env is None else env
    base_url = e.get("AGENT_MEMORY_LLM_BASE_URL") or None
    structured = e.get("AGENT_MEMORY_LLM_STRUCTURED_OUTPUT") or (
        "json_object" if base_url and "deepseek" in base_url else "json_schema")
    if structured not in ("json_schema", "json_object"):
        raise ValueError("AGENT_MEMORY_LLM_STRUCTURED_OUTPUT must be json_schema or json_object")
    driver = (e.get("AGENT_MEMORY_GRAPH_DRIVER") or "kuzu").lower()
    if driver not in ("kuzu", "falkordb"):
        raise ValueError("AGENT_MEMORY_GRAPH_DRIVER must be kuzu or falkordb")
    embed_kind = (e.get("AGENT_MEMORY_EMBEDDER") or "hash").lower()
    if embed_kind not in ("hash", "openai"):
        raise ValueError("AGENT_MEMORY_EMBEDDER must be hash or openai")
    token_env = e.get("AGENT_MEMORY_SIDECAR_TOKEN_ENV") or None
    if token_env:
        token_env = _env_name(token_env, token_env)
    return Settings(
        driver=driver,
        kuzu_path=e.get("AGENT_MEMORY_KUZU_PATH") or os.path.join(".data", "graphiti.kuzu"),
        falkordb_host=e.get("AGENT_MEMORY_FALKORDB_HOST") or "127.0.0.1",
        falkordb_port=int(e.get("AGENT_MEMORY_FALKORDB_PORT") or 6379),
        host=e.get("AGENT_MEMORY_SIDECAR_HOST") or "127.0.0.1",
        port=int(e.get("AGENT_MEMORY_SIDECAR_PORT") or 8765),
        token_env=token_env,
        llm=LLMSettings(
            base_url=base_url,
            model=e.get("AGENT_MEMORY_LLM_MODEL") or None,
            small_model=e.get("AGENT_MEMORY_LLM_SMALL_MODEL") or None,
            api_key_env=_env_name(e.get("AGENT_MEMORY_LLM_API_KEY_ENV"), "OPENAI_API_KEY"),
            structured_output=structured,
        ),
        embedder=EmbedderSettings(
            kind=embed_kind,
            base_url=e.get("AGENT_MEMORY_EMBED_BASE_URL") or None,
            model=e.get("AGENT_MEMORY_EMBED_MODEL") or None,
            api_key_env=_env_name(e.get("AGENT_MEMORY_EMBED_API_KEY_ENV"), "OPENAI_API_KEY"),
            dim=int(e.get("AGENT_MEMORY_EMBED_DIM") or 384),
        ),
    )
