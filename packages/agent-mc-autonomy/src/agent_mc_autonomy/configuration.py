"""Host-neutral settings, remote server identity and private client assembly."""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from .decision_profiles import DecisionSettings
from .fast import FastSettings
from .native_settings import NativeSettings

DEFAULT_CONTEXT_TOKENS = 65536


class SettingsValidationError(ValueError):
    """Safe structured error: never expose submitted values or exception text."""

    def __init__(self, field: str, code: str):
        self.field, self.code = field, code
        super().__init__(code)


def _text(section: dict, key: str, default: str = "") -> str:
    value = section.get(key, default)
    if not isinstance(value, str) or value != value.strip() or any(ord(char) < 32 for char in value):
        raise SettingsValidationError(key, "invalid_text")
    return value


def _integer(section: dict, key: str, default: int, minimum: int, maximum: int, field: str = "") -> int:
    value = section.get(key, default)
    if type(value) is not int or not minimum <= value <= maximum:
        raise SettingsValidationError(field or key, "invalid_integer_range")
    return value


def _boolean(section: dict, key: str, default: bool) -> bool:
    value = section.get(key, default)
    if type(value) is not bool:
        raise SettingsValidationError(key, "invalid_boolean")
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
    read_preference: str = "balanced"
    agent_id: str = ""

    @classmethod
    def parse(cls, raw: dict) -> MemorySettings:
        if not isinstance(raw, dict) or set(raw) - cls.__dataclass_fields__.keys():
            raise ValueError("memory must be a table of supported retrieval settings")
        fields = {key: _text(raw, key, value.default) for key, value in cls.__dataclass_fields__.items() if key not in {"timeout_ms", "learning_enabled"}}
        if fields["mode"] not in {"local", "local-vector", "vector", "remote"}:
            raise ValueError("memory.mode must be local, local-vector, vector or remote")
        agent_id = fields["agent_id"]
        if (sum(2 if ord(char) > 0xffff else 1 for char in agent_id) > 160
                or any(ord(char) == 127 or 0xd800 <= ord(char) <= 0xdfff for char in agent_id)):
            raise ValueError("memory.agent_id must be an optional stable identifier of at most 160 characters")
        if fields["provider"] not in {"http", "mem0-oss", "mem0-platform", "bailian", "powercontext"}:
            raise ValueError("Invalid memory provider")
        if fields["search_mode"] not in {"text", "vector", "hybrid"}:
            raise ValueError("Invalid memory search mode")
        if fields["read_preference"] not in {"local-first", "balanced", "remote-first"}:
            raise ValueError("Invalid memory read preference")
        if fields["endpoint"]:
            viewer_url(fields["endpoint"])
        key = fields["api_key_env"]
        if key and not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise ValueError("memory.api_key_env must be an environment variable name")
        if fields["mode"] in {"vector", "remote"} and not fields["endpoint"]:
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
                   "project_id": "projectId", "scope_id": "scopeId", "search_mode": "searchMode", "learning_enabled": "learningEnabled", "read_preference": "readPreference"}
        # This optional hint is also the new core's default. Omitting it keeps
        # existing strict 0.4 configurations usable; explicit nondefault choices
        # still require a core that implements the preference contract.
        return {aliases.get(key, key): getattr(self, key) for key in self.__dataclass_fields__
                if key != "agent_id" and (key != "read_preference" or self.read_preference != "balanced")}

    def environment(self) -> dict[str, str]:
        # MCP's child environment is allowlisted. Forward only this configured key, never all host credentials.
        key = self.api_key_env
        return {key: os.environ[key]} if self.mode in {"vector", "remote"} and key and key in os.environ else {}


@dataclass(frozen=True)
class KnowledgeSettings:
    """Forward an explicitly prepared reference index to the shared core."""
    minedojo_index_file: str = ""
    retrieval: str = "hybrid"

    @classmethod
    def parse(cls, raw: dict) -> KnowledgeSettings:
        if not isinstance(raw, dict) or set(raw) - cls.__dataclass_fields__.keys():
            raise ValueError("knowledge must be a table of supported local reference settings")
        index = _text(raw, "minedojo_index_file")
        mode = _text(raw, "retrieval", "hybrid")
        if index and not Path(index).is_absolute():
            raise ValueError("knowledge.minedojo_index_file must be an absolute local path")
        if mode not in {"hybrid", "lexical", "local-vector"}:
            raise ValueError("knowledge.retrieval must be hybrid, lexical or local-vector")
        return cls(index, mode)

    def client_config(self) -> dict:
        return {"minedojo": {"indexFile": self.minedojo_index_file, "retrieval": self.retrieval}} if self.minedojo_index_file else {}


@dataclass(frozen=True)
class Settings:
    enabled: bool = False
    host: str = ""
    port: int = 25565
    username: str = ""
    auth: str = "offline"
    version: str = "1.21.1"
    connection_type: str = "local"
    node: str = "node"
    backend_directory: str = ""
    body_provider: str = "mineflayer"
    java_client: dict = field(default_factory=dict)
    login_config_file: str = ""
    viewer_port: int = 0
    console_port: int = 0
    external_viewer_url: str = ""
    viewer_auto_open: bool = True
    viewer_renderer_directory: str = ""
    viewer_catalog_file: str = ""
    viewer_bundled_appearance_catalog_file: str = ""
    viewer_default_appearance: str = "server"
    viewer_listen_port: int = 28985
    server_presentation_module: str = ""
    server_presentation_sha256: str = ""
    min_decision_seconds: int = 10
    idle_decision_seconds: int = 60
    max_tool_rounds: int = 6
    max_output_tokens: int = 1024
    model_timeout_seconds: int = 180
    review_model_pool: str = ""
    context_tokens: int = DEFAULT_CONTEXT_TOKENS
    context_mode: str = "compact"
    context_history_headroom_tokens: int = 0
    max_decisions: int = 100
    runtime_mode: str = "embedded"
    data_directory: str = ""
    bundle_root: str = ""
    bundle_manifest_sha256: str = ""
    vision_enabled: bool = True
    mineral_vision: bool = False
    fast: FastSettings = field(default_factory=FastSettings)
    memory: MemorySettings = field(default_factory=MemorySettings)
    knowledge: KnowledgeSettings = field(default_factory=KnowledgeSettings)
    decision_policy: DecisionSettings = field(default_factory=DecisionSettings)
    native: NativeSettings = field(default_factory=NativeSettings)

    @classmethod
    def parse(cls, raw: dict) -> Settings:
        sections = [raw.get(key, {}) for key in ("autonomy", "server", "backend", "viewer")]
        if not all(isinstance(section, dict) for section in sections):
            raise ValueError("autonomy, server, backend and viewer must be tables")
        autonomy, server, backend, viewer = sections
        body_provider = _text(backend, "provider", "mineflayer")
        if body_provider not in {"mineflayer", "java-client"}:
            raise ValueError("backend.provider must be mineflayer or java-client")
        java_raw = raw.get("java_client", {})
        if not isinstance(java_raw, dict):
            raise ValueError("java_client must be a table")
        java_client = {}
        if body_provider == "java-client":
            if set(java_raw) - {"expected_uuid", "expected_server", "controller_id", "credentials_file", "ledger_dir", "lease_ms"}:
                raise ValueError("Unsupported java_client setting")
            fields = {key: _text(java_raw, key) for key in ("expected_uuid", "expected_server", "controller_id", "credentials_file", "ledger_dir")}
            if not re.fullmatch(r"(?:[a-fA-F0-9]{32}|[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})", fields["expected_uuid"]):
                raise ValueError("java_client.expected_uuid must be an explicit actual player UUID")
            if not all(fields.values()) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", fields["controller_id"]):
                raise ValueError("Configure explicit Java client server/controller/credentials/ledger")
            aliases = {"expected_uuid": "expectedUuid", "expected_server": "expectedServer", "controller_id": "controllerId", "credentials_file": "credentialsFile", "ledger_dir": "ledgerDir"}
            java_client = {aliases[key]: value for key, value in fields.items()}
            java_client["leaseMs"] = _integer(java_raw, "lease_ms", 15000, 1000, 30000)
            if _text(viewer, "renderer_directory"):
                raise ValueError("Java client uses its real framebuffer; do not start a second Mineflayer viewer body")
        perception = raw.get("perception", {})
        if not isinstance(perception, dict):
            raise ValueError("perception must be a table")
        runtime = raw.get("runtime", {})
        if not isinstance(runtime, dict) or runtime.get("mode", "embedded") not in {"embedded", "external"}:
            raise ValueError("runtime.mode must be embedded or external")
        host = _text(server, "host")
        if host and (len(host) > 253 or re.search(r"[\s/@?#\\]", host) or "://" in host):
            raise SettingsValidationError("server.host", "invalid_host")
        local_hosts = {"", "localhost", "127.0.0.1", "::1"}
        connection_type = _text(server, "connection_type", "local" if host.lower() in local_hosts else "custom")
        if connection_type not in {"local", "custom"} or connection_type == "local" and host.lower() not in local_hosts:
            raise SettingsValidationError("server.connection_type", "connection_type_mismatch")
        auth = _text(server, "auth", "offline")
        if auth not in {"offline", "microsoft"}:
            raise SettingsValidationError("server.auth", "invalid_auth")
        username = _text(server, "username")
        if len(username) > 254 or (username and auth == "offline" and not re.fullmatch(r"[A-Za-z0-9_]{1,16}", username)):
            raise SettingsValidationError("server.username", "invalid_username")
        version = _text(server, "version", "1.21.1")
        if version != "1.21.1" and not (body_provider == "java-client" and version == "1.20.6"):
            raise SettingsValidationError("server.version", "unsupported_version")
        if _integer(viewer, "port", 0, 0, 65535) or _integer(viewer, "console_port", 0, 0, 65535):
            raise ValueError("This headless build uses viewer.url; bundled viewer and console ports must be zero")
        operator = raw.get("operator", {})
        if not isinstance(operator, dict) or set(operator) - {"port"}:
            raise ValueError("operator supports only an optional local port")
        console_port = _integer(operator, "port", 0, 0, 65535, "operator.port")
        if console_port and (console_port < 1024 or body_provider != "mineflayer"):
            raise SettingsValidationError("operator.port", "operator_port_unprivileged")
        minimum = _integer(autonomy, "min_decision_seconds", 10, 5, 300)
        renderer, catalog = _text(viewer, "renderer_directory"), _text(viewer, "catalog_file")
        if bool(renderer) != bool(catalog):
            raise SettingsValidationError("viewer.renderer_directory", "renderer_catalog_pair_required")
        maximum_output = _integer(autonomy, "max_output_tokens", 1024, 128, 131072)
        from .review_inference import pool_name
        review_model_pool=pool_name(_text(autonomy,'review_model_pool'))
        context_mode = _text(autonomy, "context_mode", "compact")
        if context_mode not in {"compact", "full"}:
            raise SettingsValidationError("autonomy.context_mode", "invalid_context_mode")
        appearance = _text(viewer, "default_appearance", "server")
        if len(appearance) > 128 or not re.fullmatch(r"(?:server|bundled:[A-Za-z0-9_-]+|native:[A-Za-z0-9_/-]+:[A-Za-z0-9_-]+)", appearance):
            raise SettingsValidationError("viewer.default_appearance", "invalid_default_appearance")
        extension = raw.get("server_extension", {})
        if not isinstance(extension, dict) or set(extension) - {"presentation_module", "presentation_sha256"}:
            raise ValueError("server_extension supports only an explicit optional presentation port")
        presentation_module = _text(extension, "presentation_module")
        presentation_sha256 = _text(extension, "presentation_sha256")
        if (bool(presentation_module) != bool(presentation_sha256) or len(presentation_module) > 4096
                or presentation_module and ("://" in presentation_module or not presentation_module.endswith((".mjs", ".js")))
                or presentation_sha256 and not re.fullmatch(r"[a-f0-9]{64}", presentation_sha256)):
            raise SettingsValidationError("server_extension.presentation_module", "invalid_presentation_port")
        return cls(
            enabled=_boolean(autonomy, "enabled", False), host=host,
            port=_integer(server, "port", 25565, 1, 65535, "server.port"), username=username, auth=auth, version=version, connection_type=connection_type,
            node=_text(backend, "node", "node"), backend_directory=_text(backend, "directory"),
            body_provider=body_provider, java_client=java_client,
            login_config_file=_text(server, "login_config_file"),
            viewer_port=0, console_port=console_port,
            external_viewer_url=viewer_url(_text(viewer, "url")), min_decision_seconds=minimum,
            viewer_auto_open=_boolean(viewer, "auto_open", True),
            viewer_renderer_directory=renderer, viewer_catalog_file=catalog,
            viewer_bundled_appearance_catalog_file=_text(viewer, "bundled_appearance_catalog_file"),
            viewer_default_appearance=appearance,
            viewer_listen_port=_integer(viewer, "listen_port", 28985, 1024, 65535),
            server_presentation_module=presentation_module, server_presentation_sha256=presentation_sha256,
            idle_decision_seconds=_integer(autonomy, "idle_decision_seconds", 60, minimum, 3600),
            max_tool_rounds=_integer(autonomy, "max_tool_rounds", 6, 1, 12),
            max_output_tokens=maximum_output,
            model_timeout_seconds=_integer(autonomy, "model_timeout_seconds", 180, 10, 300),
            review_model_pool=review_model_pool,
            context_tokens=_integer(autonomy, "context_tokens", DEFAULT_CONTEXT_TOKENS, 4096, 2097152),
            context_mode=context_mode,
            context_history_headroom_tokens=_integer(autonomy, "context_history_headroom_tokens", 0, 0, 131072),
            max_decisions=_integer(autonomy, "max_decisions", 100, 0, 10000),
            runtime_mode=_text(runtime, "mode", "embedded"), data_directory=_text(runtime, "data_directory"),
            bundle_root=_text(runtime, "bundle_root"), bundle_manifest_sha256=_text(runtime, "bundle_manifest_sha256"),
            vision_enabled=_boolean(perception, "enabled", True),
            mineral_vision=_boolean(perception, "mineral_vision", False), fast=FastSettings.parse(raw.get("fast", {})),
            memory=MemorySettings.parse(raw.get("memory", {})),
            knowledge=KnowledgeSettings.parse(raw.get("knowledge", {})),
            decision_policy=DecisionSettings.parse(raw.get("decision_policy", {}), maximum_output),
            native=NativeSettings.parse(raw.get("native", {})),
        )

    def require_server(self) -> None:
        if not self.host or not self.username:
            raise ValueError("server_not_configured: fill server.host and server.username before connecting")
        if self.viewer_port and self.viewer_port == self.console_port:
            raise ValueError("viewer.port and viewer.console_port must be distinct (or zero to disable)")

    @property
    def identity(self) -> str:
        if self.body_provider == "java-client":
            # Keep the host ledger through a Microsoft profile rename. Offline
            # renames change UUID and still need explicit identity migration.
            text = json.dumps(["java-client", self.java_client["expectedServer"].lower(), self.java_client["controllerId"]], separators=(",", ":"))
            return hashlib.sha256(text.encode()).hexdigest()[:24]
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
            "dataDir": str(Path(self.java_client["ledgerDir"]).expanduser().resolve()) if self.body_provider == "java-client" else str(private / "client"), "timezone": "Asia/Shanghai", "acceptsImages": self.vision_enabled,
            "metricsPort": 0, "consolePort": self.console_port,
            **({"operatorIdentity": self.identity} if self.console_port else {}),
            "world": {
                **self.native.client_config(),
                **({"provider": "java-client", "javaClient": self.java_client} if self.body_provider == "java-client" else {}),
                "host": self.host, "port": self.port, "username": self.username, "auth": self.auth,
                "version": self.version, "profilesFolder": str(private / "auth"),
                "loginConfigFile": str(Path(self.login_config_file).expanduser().resolve()) if self.login_config_file else "",
                "viewerPort": self.viewer_port,
                "memory": self.memory.client_config(),
                **({"knowledge": self.knowledge.client_config()} if self.knowledge.minedojo_index_file else {}),
                **({"memoryAgentId": self.memory.agent_id} if self.memory.agent_id else {}),
                "perception": {"mineralVision": self.mineral_vision,
                               **self.native.client_config().get("perception", {})},
                "performanceBridge": {"module": "", "endpoint": ""},
                "local": {"startWithWorld": False, "serverDir": "", "cheats": False},
                "client": {"enabled": False}, "player": {"enabled": False},
            },
        }
