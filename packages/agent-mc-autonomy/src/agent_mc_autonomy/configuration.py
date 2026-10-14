"""Host-neutral settings, remote server identity and private client assembly."""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from .fast import FastSettings


def _text(section: dict, key: str, default: str = "") -> str:
    value = section.get(key, default)
    if not isinstance(value, str) or value != value.strip() or any(ord(char) < 32 for char in value):
        raise ValueError(f"Invalid text setting: {key}")
    return value


def _integer(section: dict, key: str, default: int, minimum: int, maximum: int) -> int:
    value = section.get(key, default)
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"{key} must be an integer in {minimum}..{maximum}")
    return value


def _boolean(section: dict, key: str, default: bool) -> bool:
    value = section.get(key, default)
    if type(value) is not bool:
        raise ValueError(f"{key} must be boolean")
    return value


def viewer_url(value: str) -> str:
    if not value:
        return ""
    parsed = urlsplit(value)
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or any(char.isspace() for char in value)):
        raise ValueError("viewer.url must be an HTTP(S) viewer URL without credentials, query or fragment")
    parsed.port  # Validate malformed ports without connecting.
    return value


@dataclass(frozen=True)
class MemorySettings:
    """Configuration forwarding only; retrieval, scopes and persistence live in agent-mc-world."""
    mode: str = "local"
    endpoint: str = ""
    model: str = ""
    api_key_env: str = ""
    timeout_ms: int = 3000
    provider: str = "http"
    library_id: str = ""
    project_id: str = "agent-mc"
    scope_id: str = ""
    search_mode: str = "text"
    learning_enabled: bool = False

    @classmethod
    def parse(cls, raw: dict) -> MemorySettings:
        if not isinstance(raw, dict) or set(raw) - cls.__dataclass_fields__.keys():
            raise ValueError("memory must be a table of supported retrieval settings")
        fields = {key: _text(raw, key, value.default) for key, value in cls.__dataclass_fields__.items() if key not in {"timeout_ms", "learning_enabled"}}
        if fields["mode"] not in {"local", "vector", "remote"}:
            raise ValueError("memory.mode must be local, vector or remote")
        if fields["provider"] not in {"http", "mem0-oss", "mem0-platform", "bailian", "powercontext"}:
            raise ValueError("Invalid memory provider")
        if fields["search_mode"] not in {"text", "vector", "hybrid"}:
            raise ValueError("Invalid memory search mode")
        if fields["endpoint"]:
            viewer_url(fields["endpoint"])
        key = fields["api_key_env"]
        if key and not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise ValueError("memory.api_key_env must be an environment variable name")
        if fields["mode"] != "local" and not fields["endpoint"]:
            raise ValueError("Configure memory.endpoint for external retrieval")
        if fields["mode"] == "vector" and not fields["model"]:
            raise ValueError("Configure memory.model for vector retrieval")
        if fields["mode"] == "remote" and fields["provider"] == "powercontext" and not fields["scope_id"]:
            raise ValueError("Configure an existing PowerContext memory.scope_id")
        learning = _boolean(raw, "learning_enabled", False)
        if learning and (fields["mode"] != "remote" or fields["provider"] not in {"powercontext", "http"}):
            raise ValueError("Service learning requires remote PowerContext or a learning-capable HTTP bridge")
        return cls(**fields, timeout_ms=_integer(raw, "timeout_ms", 3000, 100, 30000), learning_enabled=learning)

    def client_config(self) -> dict:
        aliases = {"api_key_env": "apiKeyEnv", "timeout_ms": "timeoutMs", "library_id": "libraryId",
                   "project_id": "projectId", "scope_id": "scopeId", "search_mode": "searchMode", "learning_enabled": "learningEnabled"}
        return {aliases.get(key, key): getattr(self, key) for key in self.__dataclass_fields__}

    def environment(self) -> dict[str, str]:
        # MCP's child environment is allowlisted. Forward only this configured key, never all host credentials.
        key = self.api_key_env
        return {key: os.environ[key]} if self.mode != "local" and key and key in os.environ else {}


@dataclass(frozen=True)
class Settings:
    enabled: bool = False
    host: str = ""
    port: int = 25565
    username: str = ""
    auth: str = "offline"
    version: str = "1.21.1"
    node: str = "node"
    backend_directory: str = ""
    login_config_file: str = ""
    viewer_port: int = 0
    console_port: int = 0
    external_viewer_url: str = ""
    viewer_auto_open: bool = True
    viewer_renderer_directory: str = ""
    viewer_catalog_file: str = ""
    viewer_listen_port: int = 28985
    min_decision_seconds: int = 10
    idle_decision_seconds: int = 60
    max_tool_rounds: int = 6
    max_output_tokens: int = 1024
    model_timeout_seconds: int = 180
    context_tokens: int = 32768
    max_decisions: int = 100
    runtime_mode: str = "embedded"
    data_directory: str = ""
    vision_enabled: bool = True
    fast: FastSettings = field(default_factory=FastSettings)
    memory: MemorySettings = field(default_factory=MemorySettings)

    @classmethod
    def parse(cls, raw: dict) -> Settings:
        sections = [raw.get(key, {}) for key in ("autonomy", "server", "backend", "viewer")]
        if not all(isinstance(section, dict) for section in sections):
            raise ValueError("autonomy, server, backend and viewer must be tables")
        autonomy, server, backend, viewer = sections
        perception = raw.get("perception", {})
        if not isinstance(perception, dict):
            raise ValueError("perception must be a table")
        runtime = raw.get("runtime", {})
        if not isinstance(runtime, dict) or runtime.get("mode", "embedded") not in {"embedded", "external"}:
            raise ValueError("runtime.mode must be embedded or external")
        host = _text(server, "host")
        if host and (len(host) > 253 or re.search(r"[\s/@?#\\]", host) or "://" in host):
            raise ValueError("server.host must be a DNS name or IP address, not a URL")
        auth = _text(server, "auth", "offline")
        if auth not in {"offline", "microsoft"}:
            raise ValueError("server.auth must be offline or microsoft")
        username = _text(server, "username")
        if len(username) > 254 or (username and auth == "offline" and not re.fullmatch(r"[A-Za-z0-9_]{1,16}", username)):
            raise ValueError("Invalid server.username for the selected authentication mode")
        version = _text(server, "version", "1.21.1")
        if version != "1.21.1":
            raise ValueError("server.version must be exactly 1.21.1 for this integration")
        if _integer(viewer, "port", 0, 0, 65535) or _integer(viewer, "console_port", 0, 0, 65535):
            raise ValueError("This headless build uses viewer.url; bundled viewer and console ports must be zero")
        minimum = _integer(autonomy, "min_decision_seconds", 10, 5, 300)
        renderer, catalog = _text(viewer, "renderer_directory"), _text(viewer, "catalog_file")
        if bool(renderer) != bool(catalog):
            raise ValueError("viewer.renderer_directory and viewer.catalog_file must be configured together")
        return cls(
            enabled=_boolean(autonomy, "enabled", False), host=host,
            port=_integer(server, "port", 25565, 1, 65535), username=username, auth=auth, version=version,
            node=_text(backend, "node", "node"), backend_directory=_text(backend, "directory"),
            login_config_file=_text(server, "login_config_file"),
            viewer_port=0, console_port=0,
            external_viewer_url=viewer_url(_text(viewer, "url")), min_decision_seconds=minimum,
            viewer_auto_open=_boolean(viewer, "auto_open", True),
            viewer_renderer_directory=renderer, viewer_catalog_file=catalog,
            viewer_listen_port=_integer(viewer, "listen_port", 28985, 1024, 65535),
            idle_decision_seconds=_integer(autonomy, "idle_decision_seconds", 60, minimum, 3600),
            max_tool_rounds=_integer(autonomy, "max_tool_rounds", 6, 1, 12),
            max_output_tokens=_integer(autonomy, "max_output_tokens", 1024, 128, 131072),
            model_timeout_seconds=_integer(autonomy, "model_timeout_seconds", 180, 10, 300),
            context_tokens=_integer(autonomy, "context_tokens", 32768, 4096, 2097152),
            max_decisions=_integer(autonomy, "max_decisions", 100, 0, 10000),
            runtime_mode=_text(runtime, "mode", "embedded"), data_directory=_text(runtime, "data_directory"),
            vision_enabled=_boolean(perception, "enabled", True), fast=FastSettings.parse(raw.get("fast", {})),
            memory=MemorySettings.parse(raw.get("memory", {})),
        )

    def require_server(self) -> None:
        if not self.host or not self.username:
            raise ValueError("server_not_configured: fill server.host and server.username before connecting")
        if self.viewer_port and self.viewer_port == self.console_port:
            raise ValueError("viewer.port and viewer.console_port must be distinct (or zero to disable)")

    @property
    def identity(self) -> str:
        text = json.dumps([self.host.lower(), self.port, self.username, self.auth], separators=(",", ":"))
        return hashlib.sha256(text.encode()).hexdigest()[:24]

    def runtime_directory(self, cache: Path) -> Path:
        return Path(self.backend_directory).expanduser().resolve() if self.backend_directory else cache / "agent-mc-world-0.4.0-headless"

    def data_root(self, default: Path) -> Path:
        return Path(self.data_directory).expanduser().resolve() if self.data_directory else default

    def client_config(self, data: Path) -> dict:
        self.require_server()
        private = data / "sessions" / self.identity
        return {
            "dataDir": str(private / "client"), "timezone": "Asia/Shanghai", "acceptsImages": self.vision_enabled,
            "metricsPort": 0, "consolePort": self.console_port,
            "world": {
                "host": self.host, "port": self.port, "username": self.username, "auth": self.auth,
                "version": self.version, "profilesFolder": str(private / "auth"),
                "loginConfigFile": str(Path(self.login_config_file).expanduser().resolve()) if self.login_config_file else "",
                "viewerPort": self.viewer_port,
                "memory": self.memory.client_config(),
                "performanceBridge": {"module": "", "endpoint": ""},
                "local": {"startWithWorld": False, "serverDir": "", "cheats": False},
                "client": {"enabled": False}, "player": {"enabled": False},
            },
        }
