"""Build a reviewed per-agent candidate; never save or reload live services.

PowerContext credentials are supplied by the private installer, not committed.
Provision an actual scope via POST /v1/scopes first: this deployed service does
not auto-create arbitrary string scope IDs. ReMe files/config remain intact.
"""
from copy import deepcopy
from urllib.parse import urlparse


def cognition_profile(profile: dict, *, scope_id: str, token: str,
                      base_url: str = "http://127.0.0.1:8100") -> dict:
    url = urlparse(base_url)
    if url.scheme != "http" or url.hostname not in {"127.0.0.1", "localhost", "::1"} or url.username or url.password:
        raise ValueError("PowerContext 必须使用现有本机入口")
    if not scope_id or not scope_id.isascii() or any(c.isspace() for c in scope_id) or len(scope_id) > 256:
        raise ValueError("先创建并核实本角色的记忆空间")
    if not token.strip() or any(c.isspace() for c in token):
        raise ValueError("从受保护文件读取有效记忆凭据")
    result = deepcopy(profile)
    running = result["running"]
    running["memory_manager_backend"] = "qiandengji-powercontext"
    running.setdefault("memory_backend_configs", {})["qiandengji-powercontext"] = {
        "base_url": base_url.rstrip("/"), "token": token, "scope_id": scope_id, "timeout": 3.0,
        "auto_memory_search_config": {"enabled": False, "max_results": 2, "max_context_bytes": 6000}}
    # Native limiter is keyed by provider:model and caches its first settings.
    # Apply at a normal QwenPaw process start, then verify actual concurrency;
    # profile hot reload alone cannot change an already-created limiter.
    running["llm_max_concurrent"] = 3
    running["loop"]["goal"] = {"max_iterations": 3, "max_tokens": 64000}
    for name in ("spawn_subagent", "check_agent_task", "qiandengji_snapshot"):
        result["tools"]["builtin_tools"][name] = {
            "name": name, "enabled": True, "display_to_user": False,
            "async_execution": name != "qiandengji_snapshot"}
    return result
