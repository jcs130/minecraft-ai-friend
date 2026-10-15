"""Bounded read-only metadata hints, never runtime or scene verification."""
from __future__ import annotations

import json
import stat
from pathlib import Path

from .configuration import SettingsValidationError


def validation_feedback(error: Exception) -> dict:
    """Allowlist codes/fields; never serialize exception text or input."""
    guidance = {
        "invalid_text": "请填写不含首尾空白和控制字符的文本。",
        "invalid_integer_range": "请填写此字段允许范围内的整数；端口须为 1–65535，账户端口为 0 或 1024–65535。",
        "invalid_boolean": "请使用开关选择启用或关闭。",
        "connection_type_mismatch": "远程地址请选择自定义连接；本地连接只接受 localhost、127.0.0.1 或 ::1。",
        "invalid_host": "填写服务器域名或 IP 地址，不要填写 URL、路径或账号。",
        "invalid_auth": "请选择离线昵称或 Microsoft 认证。",
        "invalid_username": "离线昵称须为 1–16 位字母、数字或下划线；Microsoft 请填有效账户标识。",
        "unsupported_version": "此 Mineflayer 集成要求 Java 1.21.1。",
        "operator_port_unprivileged": "Mineflayer 账户端口请填 0（关闭）或 1024–65535 的空闲本机端口。",
        "renderer_catalog_pair_required": "渲染器目录与版本资源 catalog JSON 必须一起填写，或一起留空使用文字模式。",
    }
    fields = {"server.host", "server.port", "server.connection_type", "server.username", "server.version", "server.auth", "operator.port", "viewer.renderer_directory"}
    # Helpers report bare keys; these keys have a single editable destination.
    aliases = {"username": "server.username", "host": "server.host", "version": "server.version", "node": "backend.node", "directory": "backend.directory", "renderer_directory": "viewer.renderer_directory", "catalog_file": "viewer.catalog_file", "listen_port": "viewer.listen_port"}
    for key in ("min_decision_seconds", "idle_decision_seconds", "max_tool_rounds", "max_output_tokens", "model_timeout_seconds", "context_tokens", "max_decisions"):
        aliases[key] = "autonomy." + key
    fields.update(aliases.values())
    if isinstance(error, SettingsValidationError) and error.code in guidance:
        field = aliases.get(error.field, error.field)
        if field in fields:
            return {"code": error.code, "field": field, "message": guidance[error.code]}
    return {"code": "invalid_settings", "field": "", "message": "配置不合法。请检查路径、端口、数值范围、模型预算及端点；远程 System One 要求 HTTPS。"}


def _metadata(path: Path, limit: int = 65536) -> dict:
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
        raise ValueError("metadata_invalid")
    with path.open("rb") as source:
        data = source.read(limit + 1)
    if len(data) > limit:
        raise ValueError("metadata_invalid")
    value = json.loads(data)
    if not isinstance(value, dict):
        raise ValueError("metadata_invalid")
    return value


def installation_readiness(settings, cache: Path) -> dict:
    """Only configured paths. No discovery, subprocess, sockets or hash scans."""
    pin = _metadata(Path(__file__).parent / "core_distribution/source.json")
    result = {"scope": "metadata_only_not_runtime_or_render_verification", "required_core_version": pin["version"],
              "backend_directory": "", "backend": "metadata_unavailable", "viewer": "text_only", "scene_verified": False}
    try:
        backend = settings.runtime_directory(cache)
        result["backend_directory"] = str(backend)
        package = _metadata(backend / "node_modules/agent-mc-world/package.json")
        result["backend"] = "version_matches_not_integrity_verified" if package.get("version") == pin["version"] else "version_mismatch"
    except (OSError, ValueError, UnicodeError, RecursionError):
        pass
    if not settings.viewer_renderer_directory and not settings.viewer_catalog_file:
        return result
    result["viewer"] = "renderer_catalog_pair_required"
    if not settings.viewer_renderer_directory or not settings.viewer_catalog_file:
        return result
    try:
        renderer = Path(settings.viewer_renderer_directory).expanduser()
        if not (renderer / "host/native-world-preview-host.mjs").is_file():
            result["viewer"] = "renderer_missing"
            return result
        result["viewer"] = "catalog_invalid_or_missing"
        catalog_path = Path(settings.viewer_catalog_file).expanduser()
        catalog = _metadata(catalog_path)
        packs = catalog.get("packs")
        if catalog.get("schemaVersion") != 1 or not isinstance(packs, list) or len(packs) > 128:
            return result
        matches = [pack for pack in packs if isinstance(pack, dict) and pack.get("minecraftVersion") == settings.version and pack.get("registry") == "vanilla"]
        result["viewer"] = "catalog_version_missing_or_ambiguous"
        if len(matches) != 1:
            return result
        pack = matches[0]
        directory = pack.get("assetDirectory")
        if not isinstance(directory, str) or not directory or len(directory) > 4096:
            result["viewer"] = "catalog_invalid_or_missing"
            return result
        asset = catalog_path.parent / directory
        result["viewer"] = "version_resources_invalid_or_missing"
        native = _metadata(asset / "native-assets.json", 8 * 1024 * 1024)
        receipt = _metadata(asset / "viewer-assets.json")
        registry = native.get("registryHashes", {})
        if (native.get("schemaVersion") == 1 and native.get("minecraftVersion") == settings.version
                and receipt.get("minecraftVersion") == settings.version and isinstance(registry, dict)
                and isinstance(pack.get("registrySha256"), str) and registry.get("block-states.jsonl") == pack["registrySha256"]):
            result["viewer"] = "metadata_matches_ready_to_attempt_rendering"
    except (OSError, ValueError, UnicodeError, RecursionError):
        pass
    return result
