"""Read-only, explicitly projected QwenPaw inventory. Never returns source configs.

enabled means configuration eligibility, not a running/autonomous agent. Counts:
builtin tools only; enabled MCP clients; enabled jobs.json entries. Model/provider
values are configured identifiers, not a live availability or billing check.
"""
from __future__ import annotations

import json
import importlib.util
from pathlib import Path
import re
import subprocess
from typing import Any


# Verified package metadata for this exact local image, not its mutable tag.
AUDITED_IMAGE_PACKAGES = {
    "sha256:41ddc296a4e8f281a18651c0a06dbd7c1b90b29dece4a40f6fa9b97812c408c4": "2.2.1",
    "sha256:2f8b935ba6e64a60299700d6e9fd2affdfeb12824d39d566fb8112c76a809122": "2.2.0",
    "sha256:a48facbff0b21e897ef34e43bf08b93f04f02a0a8e3bfcc37ef520527de6a751": "2.2.0",
    "sha256:041af8111ee91ec0180a5d50ca876e89301fc9d03401ee4852858431999a3181": "2.1.0",
    "sha256:1caee098f813d59973e30a4533699b594a73c3fdcfcddb192ebf385ad004eb29": "2.2.0",
    # Clean Linux rebuild, four version/source-locked hooks and Console assets
    # verified in the image; server/runtime-images/qwenpaw-recovery.json.
    "sha256:f0699f5cf3944ce34f96e3d24261aee96c31b309ac83629d8c39292ea8ea2303": "2.2.0",
    "sha256:78d69d882f287d56f2bd1cb00f946c6d9dcf2412f2dbf7a424ab694a4e1c6e09": "2.2.0",
}


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
        return value if isinstance(value, dict) else None
    except (OSError, ValueError):
        return None


def _text(value: Any, maximum: int = 160) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"[\x00-\x1f\x7f]", " ", value)[:maximum]


def _mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _container(name: str) -> dict[str, Any]:
    try:
        result = subprocess.run(
            ["docker", "inspect", name], capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=8, check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if result.returncode != 0:
            return {}
        rows = json.loads(result.stdout)
        if not isinstance(rows, list) or not rows:
            return {}
        source = rows[0]
        # The raw inspect object stays inside this function. No env, command,
        # mounts, passwords, auth or network credentials enter its return value.
        state = _mapping(source.get("State"))
        health = _mapping(state.get("Health")).get("Status")
        return {
            "state": health if state.get("Running") and health else state.get("Status", "unknown"),
            "image": _text(_mapping(source.get("Config")).get("Image")),
            "imageId": _text(source.get("Image"), 80),
        }
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {}


def _host_version(home: Path) -> str:
    package_dir = home / ".qwenpaw/venv/Lib/site-packages"
    for metadata in sorted(package_dir.glob("qwenpaw-*.dist-info/METADATA")):
        try:
            for line in metadata.read_text(encoding="utf-8").splitlines():
                if line.startswith("Version:"):
                    return _text(line.partition(":")[2].strip(), 40)
        except OSError:
            continue
    return "unknown"


def _mcp_count(profile: dict[str, Any], workspace: Path, root_mcp: Any = None) -> int | None:
    mcp = profile.get("mcp")
    mcp = root_mcp if mcp is None else mcp
    clients = _mapping(mcp).get("clients")
    if not isinstance(clients, dict):
        return None
    enabled = {name: _mapping(config).get("enabled", True) is True for name, config in clients.items()}
    # Native YAML and the migration's JSON-as-YAML cards are both accepted.
    # Only the top-level enabled flag leaves this function; endpoint/credentials
    # are never added to the public inventory.
    try:
        files = list((workspace / "drivers/mcp").glob("*.yaml"))
    except OSError:
        return None
    for file in files:
        try:
            body = file.read_text(encoding="utf-8-sig")
        except (OSError, UnicodeError):
            return None
        if body.lstrip().startswith('{'):
            try:
                card = json.loads(body)
            except ValueError:
                return None
            if not isinstance(card, dict) or type(card.get('enabled')) is not bool:
                return None
            enabled[file.stem] = card['enabled']
            continue
        match = re.search(r"^enabled:\s*(true|false)\s*(?:#.*)?$", body, re.MULTILINE | re.IGNORECASE)
        if match:
            enabled[file.stem] = match.group(1).lower() == "true"
        else:
            return None
    return sum(enabled.values())


def _job_count(workspace: Path) -> int | None:
    source = _read_json(workspace / "jobs.json")
    jobs = source.get("jobs") if source is not None else None
    if not isinstance(jobs, list) or any(not isinstance(job, dict) for job in jobs):
        return None
    return sum(job.get("enabled") is True for job in jobs)


def _skill_count(workspace: Path) -> int | None:
    manifest=_read_json(workspace/'skill.json')
    if not manifest:
        return None
    legacy=set(manifest)=={'skills','version'} and type(manifest.get('version')) is int
    if manifest.get('schema_version') != 'workspace-skill-manifest.v1' and not legacy:
        return None
    skills=manifest.get('skills')
    if not isinstance(skills,dict) or any(not isinstance(row,dict) or type(row.get('enabled')) is not bool
                                         for row in skills.values()):
        return None
    return sum(row['enabled'] for row in skills.values())


def _team_registry(project: Path):
    # Reuse the exact bounded migration parser; do not interpret an unchecked
    # JSON phase as permission to hide a currently active operations instance.
    path=Path(__file__).resolve().parents[1]/'world/ops/world_team_hosts.py'
    spec=importlib.util.spec_from_file_location('inventory_team_hosts',path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    registry=module._load_registry(project/'server/team-state/runtime-hosts.json')
    return module,registry


def _role(runtime: str, ident: str) -> str:
    if runtime == 'qiandengji-ops':
        return {'mc-god':'天神／原工程师工作区（迁移后停用）','default':'司灯／台账与协调','mc-herald':'服务诊断与行为审计',
                'mc-priest':'剧情与活动策划','mc-guard-kirito':'桐人／玩法体验分析（身体未接管）',
                'mc-guard-naruto':'鸣人／新手与协作体验分析（身体未接管）'}.get(ident,'内置辅助（停用）')
    if runtime == "qiandengji":
        return {"mc-god": "灯语女神／世界管理、问题协调与验收", "mc-herald": "灯语女神／玩家交流与问题受理",
                "qd-engineer": "天神／代码巡查、修复、测试与改进提案",
                "qd-steward": "司灯／世界运营、任务协调与台账",
                "qd-survivor": "桐人／自主生存、世界感知与技能学习",
                "qd-villager-dialogue": "村民个性对话与祈愿",
                "qd-guild-planner": "公会任务策划／按日生成可校验预案",
                "qd-maid-dialogue": "女仆对话／模组文本请求"}.get(ident, "内置辅助 Agent")
    if runtime == "shadow":
        return {"default": "司灯／旧运营组负责人", "mc-god": "天神分身／叙事与复盘", "mc-herald": "运营巡检与测试", "mc-priest": "剧情与活动策划", "mc-guard-kirito": "桐人／玩家侧体验官", "mc-guard-naruto": "鸣人／玩家侧体验官"}.get(ident, "QwenPaw 辅助 Agent")
    return {"mc-god": "宿主天神／旧世界统筹", "mc-herald": "旧世界传令", "mc-hearth": "旧世界村民代言", "mc-guard-kirito": "桐人／旧世界体验官", "mc-guard-naruto": "鸣人／旧世界体验官", "mc-guard-tno-kirito": "TNO 世界先遣角色"}.get(ident, "宿主非专属游戏 Agent")


def collect_qwenpaw_inventory(project_root: str | Path | None = None, user_home: str | Path | None = None) -> dict[str, Any]:
    """Return only runtimes/agents/issues, with no dependency on the root agent.

    Files and Docker inspection are read-only. No HTTP model calls, log/chat
    reads, jobs execution, process creation beyond docker inspect, or mutations.
    """
    project = Path(project_root) if project_root is not None else Path(__file__).resolve().parents[1]
    home = Path(user_home) if user_home is not None else Path.home()
    locations = [
        ("qiandengji", "千灯纪 QwenPaw", "container", project / "server/agents/work", "qiandengji-qwenpaw-1", "http://127.0.0.1:18089", "游戏神谕、桐人、村民、女仆及公会策划的统一 Agent 会话"),
        ("shadow", "旧世界运营组", "container", home / ".copaw/workspaces/default/minecraft-ai-friend/ops/docker/shadow/copaw", "shadow-qwenpaw", "http://127.0.0.1:18088", "旧运营组及其 MCP；主动驱动需另核"),
        ("host", "宿主 QwenPaw", "host", home / ".copaw", None, "", "宿主综合 Agent，与游戏运营组混合配置"),
    ]
    result: dict[str, Any] = {"runtimes": [], "agents": [], "issues": []}
    if (project / 'server/operations-agent-state/work/config.json').is_file():
        locations.insert(1, ('qiandengji-ops','千灯纪世界运营组','container',project/'server/operations-agent-state/work',
            'qiandengji-qwenpaw-ops-1','http://127.0.0.1:18090','项目运营支持：协调、诊断、剧情与体验分析；天神迁入游戏控制台后原实例停用'))

    def issue(code: str, severity: str, title: str, detail: str) -> None:
        result["issues"].append({"code": code, "severity": severity, "title": title, "detail": detail})

    try:
        host_module,registry=_team_registry(project)
    except (OSError,ValueError,TypeError):
        host_module,registry=None,None
        issue('team_host_registry_unavailable','warning','团队运行身份不可核实','保留配置与容器事实；不把迁移状态读取失败当作运营实例已归档。')

    for rid, label, kind, base, container_name, endpoint, purpose in locations:
        source_config = _read_json(base / "config.json")
        config = _mapping(source_config)
        source_profiles = _mapping(config.get("agents")).get("profiles")
        profiles = _mapping(source_profiles)
        profiles_known = source_config is not None and isinstance(source_profiles, dict)
        root_tools = _mapping(config.get("tools")).get("builtin_tools")
        runtime = {"id": rid, "label": label, "kind": kind, "version": _host_version(home) if kind == "host" else "unknown",
                   "endpoint": endpoint, "state": "unverified", "purpose": purpose,
                   "enabledAgentCount": sum(_mapping(v).get("enabled") is True for v in profiles.values()) if profiles_known else None,
                   "agentCount": len(profiles) if profiles_known else None}
        retired_sources=set()
        archived_targets=set()
        if registry is not None:
            retired_sources={row['source']['agentId'] for row in host_module.MIGRATIONS.values()
                             if registry['phases'][row['migration']]=='active'}
            archived_targets=registry['retired'] | registry['dormant']
        archived_runtime=rid=='qiandengji-ops' and registry is not None and len(retired_sources)==len(host_module.MIGRATIONS)
        if container_name:
            observed = _container(container_name)
            runtime["state"] = observed.get("state", "unavailable")
            if rid == 'shadow' and runtime['state'] == 'exited':
                runtime['endpoint'] = ''
                runtime['purpose'] = '旧游戏环境已停用；保留配置档案供后续按需迁移'
            package_version = AUDITED_IMAGE_PACKAGES.get(observed.get("imageId"))
            if package_version:
                runtime["version"] = package_version + " (audited image package)"
            elif observed:
                issue(f"{rid}_image_unverified", "warning", f"{label}镜像待核", "当前 immutable image ID 未命中已审计镜像；版本显示 unknown，不根据标签推断包版本。")
            if archived_runtime:
                runtime['lifecycle']='archived'
                runtime['purpose']='运营角色已迁入游戏控制台；此处仅保留历史会话、台账及配置'
                if runtime['state'] in ('unavailable','exited','created','dead'):
                    runtime['endpoint']=''
                else:
                    issue('archived_operations_runtime_running','warning','归档运营实例仍运行','运行身份已迁到游戏 QwenPaw；需检查旧实例，不能把它当成新的独立团队。')
        else:
            last_api = _mapping(config.get("last_api"))
            port = last_api.get("port")
            if isinstance(port, int) and 1 <= port <= 65535:
                runtime["endpoint"] = f"http://127.0.0.1:{port}"
        if not profiles_known:
            issue(f"{rid}_config_unavailable", "warning", f"{label}配置不可读", "未将读取失败解释为已停用；未尝试恢复或修改配置。")
        for ident, index_value in profiles.items():
            index = _mapping(index_value)
            # Container paths are mapped to their audited bind roots. Never use
            # a profile-controlled absolute path to scan another installation.
            workspace = base / "workspaces" / ident
            if not re.fullmatch(r"[A-Za-z0-9_.-]+", ident) or ident in (".", ".."):
                issue(f"{rid}_invalid_workspace_id", "warning", "忽略无效 Agent ID", "该配置未用于构造文件路径。")
                continue
            profile = _read_json(workspace / "agent.json")
            if profile is None:
                issue(f"{rid}_{ident}_profile_unavailable", "warning", "Agent 配置不可读", f"{rid}/{ident} 保留已知登记身份；工具、MCP、任务数量为未知，不标成零。")
            profile_values = _mapping(profile)
            tools = _mapping(profile_values.get("tools")).get("builtin_tools")
            tools = root_tools if tools is None else tools
            model = _mapping(profile_values.get("active_model"))
            effective=index.get('enabled') is True
            if rid=='qiandengji-ops' and ident in retired_sources:
                effective=False
            if rid=='qiandengji' and ident in archived_targets:
                effective=False
            if registry is None and rid in ('qiandengji','qiandengji-ops'):
                effective=None
            result["agents"].append({"id": ident, "label": _text(profile_values.get("name")) or ident, "runtimeId": rid,
                "enabled": index.get("enabled") is True, "role": _role(rid, ident),
                "effectiveEnabled": effective,
                "modelProvider": _text(model.get("provider_id"), 100), "model": _text(model.get("model"), 100),
                "toolCount": sum(_mapping(v).get("enabled") is True for v in tools.values()) if profile is not None and isinstance(tools, dict) else None,
                "mcpCount": _mcp_count(profile, workspace, config.get("mcp")) if profile is not None else None,
                "jobCount": _job_count(workspace) if profile is not None else None,
                "skillCount": _skill_count(workspace) if profile is not None else None})
        runtime['activeAgentCount']=(sum(row['effectiveEnabled'] is True for row in result['agents'] if row['runtimeId']==rid)
                                     if profiles_known and (registry is not None or rid not in ('qiandengji','qiandengji-ops')) else None)
        result["runtimes"].append(runtime)

    issue("enabled_not_running", "info", "启用不等于正在自主运行", "Agent 启用、容器健康、MCP 子进程与巡场驱动是不同状态；任务数仅为启用的 jobs.json 定义。")
    issue("runtime_versions_differ", "info", "历史版本差异（2026-09-07）", "当时审计的容器镜像标签为2.1.1、Python包2.1.0，宿主为2.2.0；这是历史记录，当前版本以各运行时可核实的字段为准。迁移应逐字段验证。")
    d_agents = [x for x in result["agents"] if x["runtimeId"] == "qiandengji" and x["enabled"]]
    ops_agents = [x for x in result['agents'] if x['runtimeId']=='qiandengji-ops' and x['enabled']]
    if not ops_agents and d_agents and all(x["toolCount"] == 0 and x["mcpCount"] == 0 for x in d_agents):
        issue("D_team_not_migrated", "info", "当前 D 实例是精简会话后端", "已启用角色未配置内置工具和 MCP；完整旧运营组尚未迁入。任务定义不可读时数量保持未知，不能把会话健康当作运营组运转。")
    active_external_jobs = sum(x["jobCount"] for x in result["agents"] if x["runtimeId"] == "host"
                               and not x["id"].startswith("mc-") and x["jobCount"] is not None)
    if active_external_jobs:
        issue("host_non_game_jobs", "info", "宿主非游戏任务保留", f"发现 {active_external_jobs} 项启用任务；按用户要求保留，不能随旧游戏环境一起停止。")
    shadow = next((x for x in result['runtimes'] if x['id'] == 'shadow'), {})
    if shadow.get('state') != 'exited':
        issue("legacy_access_review", "warning", "旧控制台入口需单独治理", "旧18088曾全接口发布；当前未核实其退出，需检查运行环境及入口。")
    return result


if __name__ == "__main__":
    print(json.dumps(collect_qwenpaw_inventory(), ensure_ascii=False, indent=2))
