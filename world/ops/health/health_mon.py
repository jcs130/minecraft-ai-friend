"""Read-only probes for this isolated project's integration services."""
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request
from urllib.parse import urlsplit

PROJECT = Path(__file__).resolve().parents[3]
OPERATIONS_COLLECTION = None
PASSWORDLESS_CONSOLE_CHECKS = (
    'panel-passwordless-ui', 'game-qwen-passwordless-ui', 'operations-qwen-passwordless-ui',
    'local-session-without-password', 'csrf-and-origin-enforced', 'localhost-port-bindings',
    'internal-control-unauthorized', 'host-8088-preserved',
)
LOCAL_CONSOLE_PORTS = (
    ('qiandengji-panel-1', '9090/tcp', '19091'),
    ('qiandengji-qwenpaw-1', '8088/tcp', '18089'),
    ('qiandengji-qwenpaw-ops-1', '8088/tcp', '18090'),
)
OPERATIONS_FIELDS = {
    'runtimes': {'id', 'label', 'kind', 'version', 'endpoint', 'state', 'purpose', 'enabledAgentCount', 'agentCount'},
    'agents': {'id', 'label', 'runtimeId', 'enabled', 'role', 'modelProvider', 'model', 'toolCount', 'mcpCount', 'jobCount'},
    'services': {'id', 'label', 'group', 'container', 'state', 'health', 'purpose', 'managedBy', 'dependencies'},
    'issues': {'code', 'severity', 'title', 'detail'},
    'commands': {'label', 'command'},
}
# Match the public projection in world/admin/read-model.mjs, not raw runtime configuration.
OPERATIONS_USAGE_FIELDS = {'modelCalls': 'count', 'promptTokens': 'count',
                           'completionTokens': 'count', 'elapsedSeconds': 'nonnegative'}
OPERATIONS_TEAM_FIELDS = {
    'teamPolicy': {'packageVersion': 40, 'mode': 'optional_manual',
        'maxConcurrentModels': 'count', 'maxQueriesPerMinute': 'count', 'maxIterations': 'count',
        'automaticRetries': 'optional_bool', 'delegationCooldownSeconds': 'count',
        'maxDelegationsPerDay': 'count', 'scheduledJobs': 'count', 'heartbeat': 'optional_bool',
        'roleSkills': 'role_skills'},
    'teamUsage': {'callCount': 'count', 'promptTokens': 'count', 'completionTokens': 'count',
        'cachedTokens': 'count', 'window': 'optional_today', 'generatedAt': 64},
    'teamRound': {'runId': 100, 'ok': 'bool', 'finishedAt': 64, 'mode': 'manual',
        **OPERATIONS_USAGE_FIELDS, 'roles': 'roles'},
}
OPERATIONS_ROUND_ROLE_FIELDS = {'role': 'role', 'ok': 'bool', 'requestId': 100,
                               'summary': 1600, 'errorType': 60, **OPERATIONS_USAGE_FIELDS}
MANIFEST = {
    "mc": {"health_required": True, "purpose": "Imported save, NeoForge and independent chanting-item protocol"},
    "world": {"health_required": True, "purpose": "Player commands, game adapters, optional goddess dialogue and heartbeat"},
    "gate": {"health_required": False, "purpose": "Vanilla protocol Agent entry"},
    "npc": {"health_required": True, "purpose": "Skill-book and NPC event consumers; legacy merchant availability audited separately"},
    "resources": {"health_required": True, "purpose": "Local maid voice packs"},
    "qwenpaw": {"health_required": True, "purpose": "Independent goddess dialogue model service"},
    "qwenpaw-ops": {"health_required": True, "purpose": "Six-role operations team, bounded native tasks and attributed proposals"},
    "voice": {"health_required": True, "purpose": "Local voice response queue"},
    "asr": {"health_required": True, "purpose": "Local microphone speech recognition"},
    "panel": {"health_required": True, "purpose": "Independent management page and public read models"},
    "tts": {"health_required": True, "purpose": "D owned GPU voice synthesis and maid compatibility API"},
    "control": {"health_required": True, "purpose": "Authenticated bounded service management and operation receipts"},
    "survivor": {"health_required": True, "purpose": "Kirito autonomous survival, leased Numen actions and tested skills"},
}
SURVIVOR_SMOKE_CHECKS = ('bound-kirito-identity', 'single-action-lease', 'no-unknown-replay',
    'survivor-status-panel', 'survivor-supervised-runtime', 'autonomous-task-evidence')
SURVIVOR_ADVENTURE_CHECKS = ('native-39-tools', 'loaded-block-scan', 'physical-menu-identity',
    'bound-guild-board', 'live-life-panel', 'resumed-model-action', 'strict-3d-arrival')
SURVIVOR_FAST_SYSTEM_CHECKS = ('bounded-program-wait', 'program-read-only-observation',
    'slow-signal-batching', 'qwen-independent-execution', 'original-skill-retested')

OPERATIONS_TEAM_CONTAINER = 'qiandengji-qwenpaw-ops-1'
OPERATIONS_TEAM_ROLES = ('default', 'mc-god', 'mc-herald', 'mc-priest', 'mc-guard-kirito', 'mc-guard-naruto')
OPERATIONS_TEAM_SMOKE_CHECKS = (
    'runtime-2.2.0', 'role-skills-installed', 'native-task-report',
    'cost-budget-enforced', 'operations-ui', 'game-services-preserved',
)

VOICE_SMOKE_CHECKS = (
    'voice:model-endpoint-unreachable', 'voice:reserved-qa-fixture',
    'voice:tts-wav-generated', 'voice:asr-recording-time-preserved',
    'voice:command-receipt', 'voice:three-firework-entities',
    'voice:replay-no-second-cast', 'voice:custom-staff-armed', 'voice:audio-boundary-ack',
)

STAFF_ITEMS = ('qiandeng_chanting:whispering_staff', 'qiandeng_chanting:resonance_staff')
STAFF_SMOKE_CHECKS = (
    'staff:registered-items-and-recipes', 'staff:direct-voice-without-staff',
    'staff:holding-needs-gesture', 'staff:whispering-gesture-single-claim',
    'staff:resonance-gesture-single-claim', 'staff:release-grace-claim',
    'staff:expired-release-rejected', 'staff:hand-swap-rejected',
    'staff:same-item-replacement-rejected', 'staff:mode-payload-and-late-voice',
    'staff:audio-boundary-handshake',
)
RECORDING_PRESERVED_CLASSES = tuple('dev/god/godvoice/' + name + '.class' for name in (
    'GodVoiceLog', 'GodVoiceMod', 'GodVoicePlugin', 'TtsQueueWatcher'))
RECORDING_REQUIRED_SOURCES = tuple('world/god-voice-src/' + name for name in (
    'dev/god/godvoice/MicCapture.java', 'dev/god/godvoice/CaptureInterval.java',
    'build.py', 'source-origin.json', 'tests/CaptureIntervalTest.java', 'META-INF/neoforge.mods.toml'))
EDITOR_SMOKE_CHECKS = (
    'skillbar:compass-editor-eight-slots', 'skillbar:shift-cannot-edit',
    'skillbar:click-set-mirrored-and-unique', 'skillbar:click-clear-preserves-positions',
    'skillbar:click-auto-same-service', 'skillbar:editing-does-not-cast',
)
CHANTING_CLIENT_CHECKS = (
    'qa-backed-up', 'real-neoforge-joined', 'both-items-registered',
    'two-item-framebuffers-captured', 'editor-framebuffer-captured', 'current-client-log-no-new-errors',
)
CHANTING_CLIENT_CLEANUP = (
    'qaOffline', 'ownedClientStopped', 'qaNativeRestored', 'qaMagicRestored',
    'otherProfilesPreservedDuringRestore', 'historicalRuntimeRestored', 'worldHealthy',
    'mcNotRestarted', 'audioRecorderUnchanged', 'lockReleased',
)


def probe_services():
    result = subprocess.run(["docker", "compose", "--project-directory", str(PROJECT),
                             "-f", str(PROJECT / "compose.yml"), "ps", "-a", "--format", "json"],
                            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
    if result.returncode:
        return {"ok": False, "error": "Unable to read the isolated Docker project status"}
    raw = result.stdout.strip()
    rows = json.loads(raw) if raw.startswith('[') else [json.loads(line) for line in raw.splitlines() if line.strip()]
    rows = rows if isinstance(rows, list) else [rows]
    services = {row.get("Service"): row for row in rows}
    checks = {}
    for name, expected in MANIFEST.items():
        row = services.get(name, {})
        running = row.get("State") == "running"
        healthy = row.get("Health") == "healthy" if expected["health_required"] else True
        checks[name] = {"ok": running and healthy, "state": row.get("State", "missing"),
                        "health": row.get("Health", "unavailable"), "purpose": expected["purpose"]}
    return {"ok": all(check["ok"] for check in checks.values()), "checks": checks}


def probe_panel_smoke():
    runtime = probe_panel_http()
    management = probe_management()
    visual = probe_recorded_behavior('admin-panel-smoke.json', (
        'overview-live-data', 'navigation-and-skills', 'guild-and-world',
        'provider-console-link', 'mobile-layout', 'no-browser-errors'))
    operations_view = probe_recorded_behavior('operations-project-view-smoke.json', (
        'current-project-roles', 'project-only-counts', 'no-runtime-switcher', 'browser-render'))
    eye_performance = probe_recorded_behavior('eye-performance-smoke.json', (
        'state-map-live', 'three-view-geometry', 'sustained-navigation',
        'bounded-events', 'cached-assets', 'world-progress-preserved'))
    observer_view = probe_recorded_behavior('eye-observer-smoke.json', (
        'first-person-no-hand', 'other-camera-views', 'static-asset-refreshed'), showHand=False)
    sources = probe_source_record('architecture-current.json')
    player_commands = probe_player_commands()
    voice_commands = probe_voice_commands()
    chanting_staff = probe_chanting_staff()
    voice_recording = probe_voice_recording()
    voice_boundary_deployment = probe_voice_boundary_deployment()
    skillbar_editor = probe_skillbar_editor()
    chanting_client = probe_chanting_client()
    operations_team = probe_operations_team()
    game_qwenpaw = probe_game_qwenpaw()
    survivor = probe_survivor()
    survivor_party = probe_survivor_party()
    model_routing = probe_model_routing()
    world_team = probe_world_team()
    return {'ok': all(value['ok'] for value in (runtime, management, visual, operations_view, eye_performance, observer_view, sources, player_commands, voice_commands, chanting_staff, voice_recording, voice_boundary_deployment, skillbar_editor, chanting_client, operations_team, game_qwenpaw, survivor, survivor_party, model_routing, world_team)),
            'runtime': runtime, 'operations': runtime.get('operations'), 'visual': visual, 'sources': sources,
            'management': management, 'operations_view': operations_view, 'eye_performance': eye_performance, 'observer_view': observer_view,
            'player_commands': player_commands, 'voice_commands': voice_commands,
            'chanting_staff': chanting_staff, 'voice_recording': voice_recording,
            'voice_boundary_deployment': voice_boundary_deployment,
            'skillbar_editor': skillbar_editor, 'chanting_client': chanting_client,
            'operations_team': operations_team, 'game_qwenpaw': game_qwenpaw, 'survivor': survivor,
            'model_routing': model_routing, 'survivor_party': survivor_party, 'world_team': world_team}


def probe_world_team():
    """Only local metadata, no model/admin request or world action is issued.

    A fresh consumer establishes availability. Counts are reported separately;
    they cannot establish that a particular quest, fix or gameplay test passed.
    """
    now = time.time()
    checks, evidence = {}, {}

    def read(relative, maximum=262144):
        path = PROJECT / relative
        if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents)):
            raise ValueError('linked_team_probe')
        with path.open('rb') as stream:
            raw = stream.read(maximum + 1)
        if len(raw) > maximum:
            raise ValueError('team_probe_size')
        result = json.loads(raw.decode('utf-8-sig'))
        if not isinstance(result, dict):
            raise ValueError('team_probe_shape')
        return result

    def fresh(value, maximum=120, milliseconds=False):
        if type(value) not in (int, float) or not math.isfinite(value):
            return False
        stamp = value / 1000 if milliseconds else value
        return -5 <= now - stamp <= maximum

    try:
        npc = read('server/mcdata/npc-health.json')
        collector = read('server/team-state/collector-health.json')
        stages = collector['stages']
        checks['existing_npc_worker'] = (fresh(npc.get('updated_at'), 100)
            and npc.get('guild_agent_enabled') is True and npc.get('threads', {}).get('guild-planner') is True)
        checks['team_collector'] = (collector.get('schema') == 1 and collector.get('protocol') == 1
            and collector.get('owner') == 'npc:guild-planner' and fresh(collector.get('updatedAt'))
            and collector.get('ok') is True and collector.get('newThreads') == 0
            and collector.get('contentOuterGuildLock') is False
            and all(isinstance(stages.get(name), dict) and stages[name].get('ok') is True
                    and fresh(stages[name].get('checkedAt')) for name in ('admin', 'content', 'planning', 'operations')))
        evidence['stages'] = {name: {'ok': stages.get(name, {}).get('ok') is True}
                              for name in ('admin', 'content', 'planning', 'operations')}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        checks.setdefault('existing_npc_worker', False)
        checks['team_collector'] = False
    try:
        admin = read('server/team-state/admin/consumer.json', 16384)
        counts = {name: admin.get(name) for name in ('pending', 'unresolved', 'completed')}
        valid_counts = all(type(v) is int and v >= 0 for v in counts.values())
        checks['admin_consumer'] = (admin.get('schema') == 1 and admin.get('protocol') == 1
            and fresh(admin.get('updatedAt'), milliseconds=True) and admin.get('actor') == 'game:mc-god'
            and type(admin.get('modelCalls')) is int and admin.get('modelCalls') == 0
            and admin.get('retriesWorldWrites') is False and valid_counts)
        checks['admin_no_unresolved_write'] = valid_counts and counts['unresolved'] == 0
        if valid_counts:
            evidence['admin'] = counts
    except (OSError, ValueError, KeyError, TypeError):
        checks['admin_consumer'] = checks['admin_no_unresolved_write'] = False
    try:
        content = read('server/team-state/content/status.json')
        context = read('server/team-state/content/context.json')
        capabilities = content['capabilities']
        publications = content['publications']
        required = ('story', 'gather', 'hunt', 'visit', 'existing', 'boss', 'chest')
        valid_capabilities = (isinstance(capabilities, dict)
            and all(isinstance(capabilities.get(name), dict) and type(capabilities[name].get('ready')) is bool for name in required))
        valid_publications = (isinstance(publications, list) and len(publications) <= 256
            and all(isinstance(row, dict) and row.get('status') in
                    ('published', 'scheduled', 'blocked', 'expired', 'publication_unconfirmed') for row in publications))
        checks['content_consumer'] = (content.get('schema') == 1 and context.get('schema') == 1
            and fresh(content.get('updatedAt')) and fresh(context.get('updatedAt'))
            and valid_capabilities and valid_publications
            and all(capabilities[name]['ready'] is True for name in ('story', 'gather', 'hunt', 'visit', 'existing')))
        checks['content_no_unknown_publication'] = valid_publications and all(row['status'] != 'publication_unconfirmed' for row in publications)
        if valid_capabilities:
            evidence['contentCapabilities'] = {name: capabilities[name]['ready'] for name in required}
        if valid_publications:
            evidence['contentPublications'] = {status: sum(row['status'] == status for row in publications)
                for status in ('published', 'scheduled', 'blocked', 'expired', 'publication_unconfirmed')}
        evidence['receptionReady'] = context.get('receptionReady') is True
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        checks['content_consumer'] = checks['content_no_unknown_publication'] = False
    try:
        world = read('server/world-data/world-heartbeat.json')
        checks['legacy_automatic_models_disabled'] = (fresh(world.get('ts'), 100, milliseconds=True)
            and world.get('automaticModelJobs') == {'review': False, 'dailyReport': False})
    except (OSError, ValueError, KeyError, TypeError):
        checks['legacy_automatic_models_disabled'] = False
    try:
        engineering = read('server/engineering/receipts/_runner.json', 16384)
        busy = engineering.get('busy')
        checks['engineering_runner'] = (engineering.get('schema') == 1 and engineering.get('enabled') is True
            and type(busy) is bool and fresh(engineering.get('updatedAt'), 330 if busy else 45, milliseconds=True)
            and engineering.get('error') is None)
        evidence['engineering'] = {'busy': busy if type(busy) is bool else None,
                                   'hasError': engineering.get('error') is not None}
    except (OSError, ValueError, KeyError, TypeError):
        checks['engineering_runner'] = False
    return {'ok': all(checks.values()), 'checks': checks, 'evidence': evidence,
            'modelRequests': 0, 'worldActions': 0,
            'scope': 'Existing supervised consumers, readiness and unresolved receipts; individual gameplay/publication/test success needs correlated evidence.'}


def probe_survivor_party():
    try:
        spec = importlib.util.spec_from_file_location('qd_party_health', PROJECT / 'tools/party_health.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.check()
    except Exception as error:
        return {'ok': False, 'errorType': type(error).__name__}


def probe_model_routing():
    """Inspect local routing only; this probe never creates a model task."""
    try:
        source = Path(__file__).resolve().parents[3] / 'tools/model_routing_health.py'
        spec = importlib.util.spec_from_file_location('model_routing_health', source)
        module = importlib.util.module_from_spec(spec)
        paths = list(sys.path)
        try:
            # validate_profile imports its runtime helper lazily during probe().
            # Keep both project helper roots available until all checks finish.
            sys.path[:0] = [str(source.parent), str(source.parents[1] / 'world/ops')]
            spec.loader.exec_module(module)
            runtime = module.probe(PROJECT)
            behavior = probe_recorded_behavior('model-routing-smoke.json', module.SMOKE_CHECKS)
            return {'ok': runtime['ok'] and behavior['ok'], 'runtime': runtime, 'behavior': behavior}
        finally:
            sys.path[:] = paths
    except (OSError, ValueError, TypeError, AttributeError, ImportError):
        return {'ok': False, 'error': 'Model routing could not be verified; no model task was submitted'}


def probe_world_operations():
    """Read native cron and NPC planner evidence without triggering either."""
    try:
        source=PROJECT/'tools/world_operations_health.py'
        spec=importlib.util.spec_from_file_location('qd_world_operations_health',source)
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.check(root=PROJECT)
    except (OSError,ValueError,KeyError,TypeError,ImportError):
        return {'ok':False,'error':'World daily operations evidence unavailable','modelRequests':0,'worldActions':0}


def probe_numen_autonomy():
    """Actual entity ticking, not just an online body or a running task brain."""
    try:
        spec = importlib.util.spec_from_file_location('qd_numen_autonomy_health', PROJECT/'tools/numen_autonomy_health.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.check(root=PROJECT)
    except (OSError, ValueError, KeyError, TypeError, ImportError):
        return {'ok': False, 'error': 'Native body tick evidence unavailable', 'modelRequests': 0, 'worldActions': 0}


def probe_survivor_fast_behavior():
    """A current protocol needs its own bounded evidence, not the old smoke."""
    filename = 'survivor-fast-system-smoke.json'
    result = {'ok': False, 'report': filename, 'missing_checks': list(SURVIVOR_FAST_SYSTEM_CHECKS)}
    try:
        path = PROJECT / 'reports' / filename
        if not path.is_file() or path.is_symlink() or path.stat().st_size > 262144:
            raise ValueError('invalid_fast_system_report')
        report = json.loads(path.read_text(encoding='utf-8-sig'))
        if (type(report.get('schema')) is not int or report['schema'] != 1
                or report.get('project') != 'qiandengji' or report.get('ok') is not True
                or type(report.get('fastSystemProtocol')) is not int or report['fastSystemProtocol'] != 1):
            raise ValueError('fast_system_report_protocol_missing')
        rows = report.get('checks')
        if isinstance(rows, dict):
            if any(not isinstance(value, dict) for value in rows.values()):
                raise ValueError('invalid_fast_system_checks')
            rows = [{'name': name, 'ok': value.get('ok')} for name, value in rows.items()]
        if (not isinstance(rows, list) or not 1 <= len(rows) <= 64
                or any(not isinstance(row, dict) or not isinstance(row.get('name'), str)
                       or not row['name'] or row.get('ok') is not True for row in rows)):
            raise ValueError('invalid_fast_system_checks')
        names = [row['name'] for row in rows]
        if len(names) != len(set(names)):
            raise ValueError('duplicate_fast_system_check')
        result['missing_checks'] = sorted(set(SURVIVOR_FAST_SYSTEM_CHECKS) - set(names))
        finished = operations_time(report.get('finishedAt'))
        if finished.timestamp() > time.time() + 5:
            raise ValueError('future_fast_system_report')
        result.update(ok=not result['missing_checks'], checked_at=report['finishedAt'])
    except (OSError, ValueError, TypeError, AttributeError, KeyError, OverflowError):
        result['error'] = 'Fast-system behavior evidence is missing or invalid'
    return result


def probe_survivor():
    """Current read-only survivor status plus separate recorded action evidence."""
    checks = {'snapshot_fresh': False, 'supervised_container': False, 'panel_projection': False,
              'adventure_projection': False, 'no_unexpected_pause': False,
              'execution_systems': False, 'fast_system_protocol': False,
              'inference_limits_unrestricted': False}
    try:
        target = PROJECT/'server/panel-state/survivor.json'
        if target.is_symlink() or target.stat().st_size > 262144:
            raise ValueError('invalid_snapshot')
        source = json.loads(target.read_text(encoding='utf-8-sig'))
        timestamp = operations_time(source.get('generatedAt'))
        checks['snapshot_fresh'] = (source.get('schema') == 1 and source.get('project') == 'qiandengji-survivor'
            and source.get('character') == '桐人' and source.get('bodyName') == 'Kirito'
            and -5 <= time.time() - timestamp.timestamp() <= 90)
        systems = source.get('executionSystems')
        if isinstance(systems, dict):
            fast, slow = systems.get('fast'), systems.get('slow')
            checks['execution_systems'] = (type(systems.get('schema')) is int and systems['schema'] == 1
                and systems.get('automaticFoodReflex') is False
                and isinstance(fast, dict) and isinstance(slow, dict)
                and fast.get('owner') == 'native-ai-and-tested-programs'
                and fast.get('requiresModelPerStep') is False
                and type(fast.get('active')) is bool and type(fast.get('waiting')) is bool
                and all(type(fast.get(key)) is int and fast[key] >= 0 for key in ('steps', 'observations'))
                and (fast.get('name') is None or isinstance(fast.get('name'), str) and len(fast['name']) <= 48)
                and (fast.get('nextCheckAt') is None or type(fast.get('nextCheckAt')) in (int, float)
                     and math.isfinite(fast['nextCheckAt']) and fast['nextCheckAt'] >= 0)
                and slow.get('owner') == 'qwenpaw' and type(slow.get('active')) is bool
                and isinstance(slow.get('status'), str) and slow['status'] == source.get('status')
                and 'readiness' in slow)
        heartbeat_path = PROJECT / 'server/survival-agent-state/survival/heartbeat.json'
        if not heartbeat_path.is_symlink() and heartbeat_path.stat().st_size <= 16384:
            heartbeat = json.loads(heartbeat_path.read_text(encoding='utf-8-sig'))
            checks['fast_system_protocol'] = (type(heartbeat.get('schema')) is int and heartbeat['schema'] == 1
                and heartbeat.get('ok') is True and type(heartbeat.get('fastSystemProtocol')) is int
                and heartbeat['fastSystemProtocol'] == 1 and type(heartbeat.get('at')) in (int, float)
                and math.isfinite(heartbeat['at']) and -5 <= time.time() - heartbeat['at'] / 1000 <= 90)
        reason = source.get('pauseReason') or ''
        checks['no_unexpected_pause'] = (source.get('enabled') is True
            and source.get('status') not in ('paused', 'stopped', 'body_offline')) or (
            source.get('enabled') is False and reason in ('operator_pause', 'operator_stop', ''))
        result = subprocess.run(['docker', 'inspect', 'qiandengji-survivor-1'], capture_output=True,
            text=True, encoding='utf-8', errors='replace', timeout=12)
        if result.returncode == 0:
            row = json.loads(result.stdout)[0]
            state = row.get('State', {})
            labels = row.get('Config', {}).get('Labels', {})
            checks['supervised_container'] = (state.get('Status') == 'running'
                and state.get('Health', {}).get('Status') == 'healthy'
                and labels.get('com.docker.compose.project') == 'qiandengji'
                and labels.get('com.docker.compose.service') == 'survivor'
                and row.get('HostConfig', {}).get('RestartPolicy', {}).get('Name') == 'unless-stopped')
        with urllib.request.urlopen('http://127.0.0.1:19091/api/state', timeout=6) as response:
            payload = response.read(2097153)
        if len(payload) > 2097152:
            raise ValueError('oversized_panel')
        public = json.loads(payload).get('survivor', {})
        settings_path = PROJECT / 'server/survival-agent-state/survival/settings.json'
        if not settings_path.is_symlink() and settings_path.stat().st_size <= 262144:
            settings = json.loads(settings_path.read_text(encoding='utf-8-sig'))
            budgets, visible_budgets = source.get('budgets', {}), public.get('budgets', {})
            checks['inference_limits_unrestricted'] = (
                'dailyPlanningLimit' in settings and settings['dailyPlanningLimit'] is None
                and type(settings.get('decisionCooldownSeconds')) in (int, float)
                and settings['decisionCooldownSeconds'] == 0
                and all(isinstance(row, dict) and row.get('inferenceLimitPolicy') == 'unrestricted'
                    and 'decisionLimit' in row and row['decisionLimit'] is None
                    and 'dailyPlanningLimit' in row and row['dailyPlanningLimit'] is None
                    and type(row.get('cooldownSeconds')) in (int, float) and row['cooldownSeconds'] == 0
                    and row.get('decisionCountScope') == 'rolling_24h'
                    and type(row.get('decisionsUsed')) is int and row['decisionsUsed'] >= 0
                    for row in (budgets, visible_budgets)))
        checks['panel_projection'] = (public.get('available') is True and public.get('stale') is False
            and public.get('character') == '桐人' and public.get('bodyName') == 'Kirito'
            and abs((operations_time(public.get('generatedAt')) - timestamp).total_seconds()) < 30)
        adventure, visible = source.get('adventure', {}), public.get('adventure', {})
        checks['adventure_projection'] = (isinstance(adventure, dict) and isinstance(visible, dict)
            and adventure.get('schema') == 1 and visible.get('available') is True
            and visible.get('resources', {}).get('known') is (adventure.get('resources', {}).get('known') is True)
            and visible.get('equipment', {}).get('known') is (adventure.get('equipment', {}).get('known') is True)
            and isinstance(public.get('constructionAreas'), list)
            and public.get('constructionAreasKnown') is isinstance(source.get('constructionAreas'), list))
        paused = source.get('status') == 'paused' and source.get('enabled') is False
    except (OSError, ValueError, TypeError, KeyError, AttributeError, IndexError, subprocess.TimeoutExpired):
        paused = False
    behavior = probe_recorded_behavior('survivor-smoke.json', SURVIVOR_SMOKE_CHECKS)
    adventure_behavior = probe_recorded_behavior('survivor-adventure-smoke.json', SURVIVOR_ADVENTURE_CHECKS)
    fast_behavior = probe_survivor_fast_behavior()
    return {'ok': all(checks.values()) and behavior['ok'] and adventure_behavior['ok'] and fast_behavior['ok'], 'checks': checks, 'paused': paused,
        'behavior': behavior, 'adventure_behavior': adventure_behavior,
        'fast_system_behavior': fast_behavior,
        'scope': 'Live status, fast/slow protocol and supervision; separate recorded behavior evidence. No model calls; no blanket life-goal completion.'}


def probe_game_qwenpaw():
    """Verify the upgraded game service separately from historical model replies."""
    runtime = {'ok': False}
    try:
        result = subprocess.run(
            ['docker', 'exec', 'qiandengji-qwenpaw-1', 'python', '/ops/qwenpaw_health.py'],
            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=45,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode != 0 or len(result.stdout.encode('utf8')) > 65536:
            raise ValueError('Invalid game readiness receipt')
        receipt = json.loads(result.stdout.strip().splitlines()[-1])
        runtime = {'ok': (receipt.get('ok') is True and receipt.get('project') == 'qiandengji'
            and receipt.get('packageVersion') == '2.2.0'
            and type(receipt.get('agents')) is int
            and type(receipt.get('maidAgents')) is int and 0 <= receipt['maidAgents'] <= 64
            and receipt.get('baseAgents') == 6 and receipt['agents'] == 6 + receipt['maidAgents']
            and receipt.get('cronBudgetGuardVerified') is True
            and type(receipt.get('installedSkillBindings')) is int and receipt['installedSkillBindings'] >= 30
            and type(receipt.get('enabledTools')) is int and receipt['enabledTools'] == 7
            and receipt.get('nativeToolPolicyVerified') is True
            and receipt.get('authMode') == 'local-passwordless'
            and receipt.get('anonymousAccess') is True),
            'packageVersion': receipt.get('packageVersion')}
    except (OSError, subprocess.SubprocessError, ValueError, TypeError, AttributeError, IndexError):
        runtime = {'ok': False, 'error': 'Game QwenPaw readiness could not be verified'}
    behavior = probe_recorded_behavior('game-qwenpaw-upgrade-smoke.json', (
        'official-update-command', 'offline-config-migration', 'state-preserved',
        'world-provider-connection', 'passwordless-agents-ui', 'other-runtimes-preserved'))
    return {'ok': runtime['ok'] and behavior['ok'], 'runtime': runtime, 'behavior': behavior,
            'scope': '2.2.0 game runtime readiness and upgrade checks; no new model inference test'}


def probe_operations_team():
    """Check the fixed D runtime without inference, and require recorded behavior separately."""
    checks = {name: False for name in ('runtime_identity', 'six_roles', 'role_skills_installed',
              'passwordless_access', 'rate_limit', 'driver_policy', 'native_tools_scoped', 'managed_weekly_jobs')}
    failure = None
    try:
        process = subprocess.run(
            ['docker', 'exec', OPERATIONS_TEAM_CONTAINER, 'python', '/ops/operations_team_health.py'],
            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if process.returncode != 0:
            raise ValueError('runtime_probe_failed')
        if len(process.stdout.encode('utf-8')) > 65536:
            raise ValueError('runtime_probe_oversized')
        lines = process.stdout.strip().splitlines()
        receipt = json.loads(lines[-1]) if lines else None
        if not isinstance(receipt, dict) or receipt.get('ok') is not True:
            raise ValueError('runtime_probe_invalid')
        checks.update({
            'runtime_identity': receipt.get('project') == 'qiandengji-ops' and receipt.get('packageVersion') == '2.2.0',
            'six_roles': type(receipt.get('roles')) is int and receipt['roles'] == 6,
            'role_skills_installed': type(receipt.get('installedSkillBindings')) is int and receipt['installedSkillBindings'] >= 36,
            'passwordless_access': (receipt.get('authMode') == 'local-passwordless'
                and receipt.get('authEnabled') is False and receipt.get('authEnforced') is False
                and receipt.get('anonymousAccess') is True),
            'rate_limit': receipt.get('rateLimitVerified') is True,
            'driver_policy': receipt.get('driverPolicyVerified') is True,
            'native_tools_scoped': (type(receipt.get('builtinTools')) is int and receipt['builtinTools'] == 7
                and receipt.get('nativeToolPolicyVerified') is True),
            'managed_weekly_jobs': (type(receipt.get('managedWeeklyJobs')) is int and receipt['managedWeeklyJobs'] == 6
                and type(receipt.get('unmanagedAutomaticJobs')) is int and receipt['unmanagedAutomaticJobs'] == 0
                and receipt.get('cronBudgetGuardVerified') is True),
        })
    except (OSError, subprocess.SubprocessError, ValueError, TypeError, AttributeError, OverflowError):
        # Never publish container stdout/stderr, which may include private diagnostics.
        failure = 'Operations runtime could not be verified'

    filename = 'operations-team-smoke.json'
    behavior = {'ok': False, 'report': filename, 'missing_checks': list(OPERATIONS_TEAM_SMOKE_CHECKS)}
    try:
        path = PROJECT/'reports'/filename
        if not path.is_file() or path.is_symlink() or path.stat().st_size > 256 * 1024:
            raise ValueError('Missing or oversized behavior evidence')
        record = json.loads(path.read_text(encoding='utf-8-sig'))
        raw_checks = record.get('checks')
        if isinstance(raw_checks, dict):
            rows = [{'name': name, 'ok': value.get('ok')} for name, value in raw_checks.items() if isinstance(value, dict)]
            if len(rows) != len(raw_checks):
                raise ValueError('Invalid behavior checks')
        elif isinstance(raw_checks, list):
            rows = raw_checks
        else:
            raise ValueError('Invalid behavior checks')
        if not 1 <= len(rows) <= 64 or any(not isinstance(row, dict) or not isinstance(row.get('name'), str)
                                          or not row['name'] or row.get('ok') is not True for row in rows):
            raise ValueError('Failed or invalid behavior checks')
        names = [row['name'] for row in rows]
        if len(names) != len(set(names)):
            raise ValueError('Duplicate behavior checks')
        finished = operations_time(record.get('finishedAt'))
        behavior.update({
            'ok': (record.get('ok') is True and type(record.get('schema')) is int and record['schema'] == 1
                   and record.get('project') in ('qiandengji', 'qiandengji-ops')
                   and finished.timestamp() <= time.time() + 5
                   and set(OPERATIONS_TEAM_SMOKE_CHECKS) <= set(names)),
            'missing_checks': sorted(set(OPERATIONS_TEAM_SMOKE_CHECKS) - set(names)),
            'checked_at': record.get('finishedAt'),
        })
    except (OSError, ValueError, KeyError, TypeError, AttributeError, OverflowError):
        behavior['error'] = 'Recorded operations behavior is unavailable or invalid'
    result = {'ok': all(checks.values()) and behavior['ok'], 'live': all(checks.values()),
              'container': OPERATIONS_TEAM_CONTAINER, 'checks': checks, 'behavior': behavior,
              'scope': 'Current passwordless local configuration and separately recorded native-task/UI behavior; no model call in this probe'}
    if failure:
        result['error'] = failure
    return result


def probe_passwordless_consoles():
    """Verify only the three project bindings and require separate actual UI/security evidence."""
    ports_ok = False
    try:
        process = subprocess.run(
            ['docker', 'inspect', '--format', '{{json .NetworkSettings.Ports}}',
             *(name for name, _, _ in LOCAL_CONSOLE_PORTS)],
            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=15,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if process.returncode != 0 or len(process.stdout.encode('utf-8')) > 16384:
            raise ValueError('Binding inspection failed')
        rows = [json.loads(line) for line in process.stdout.splitlines() if line.strip()]
        ports_ok = len(rows) == len(LOCAL_CONSOLE_PORTS)
        for row, (_, container_port, host_port) in zip(rows, LOCAL_CONSOLE_PORTS):
            ports_ok = ports_ok and isinstance(row, dict) and (
                row.get(container_port) == [{'HostIp': '127.0.0.1', 'HostPort': host_port}]
                and all(value in (None, []) for key, value in row.items() if key != container_port))
    except (OSError, subprocess.SubprocessError, ValueError, TypeError, AttributeError):
        ports_ok = False

    filename = 'passwordless-console-smoke.json'
    behavior = {'ok': False, 'report': filename, 'missing_checks': list(PASSWORDLESS_CONSOLE_CHECKS)}
    try:
        path = PROJECT/'reports'/filename
        if not path.is_file() or path.is_symlink() or path.stat().st_size > 256*1024:
            raise ValueError('Missing or oversized passwordless evidence')
        report = json.loads(path.read_text(encoding='utf-8-sig'))
        raw = report.get('checks')
        if isinstance(raw, dict):
            rows = [{'name': name, 'ok': value.get('ok')} for name, value in raw.items()
                    if isinstance(value, dict)]
            if len(rows) != len(raw):
                raise ValueError('Invalid passwordless checks')
        else:
            rows = raw
        if not isinstance(rows, list) or not 1 <= len(rows) <= 64 or any(
                not isinstance(row, dict) or not isinstance(row.get('name'), str)
                or not row['name'] or row.get('ok') is not True for row in rows):
            raise ValueError('Invalid or unsuccessful passwordless checks')
        names = [row['name'] for row in rows]
        if len(names) != len(set(names)):
            raise ValueError('Duplicate passwordless checks')
        finished = operations_time(report.get('finishedAt'))
        behavior.update({
            'ok': (report.get('ok') is True and type(report.get('schema')) is int
                and report['schema'] == 1 and report.get('project') == 'qiandengji'
                and finished.timestamp() <= time.time()+5
                and set(PASSWORDLESS_CONSOLE_CHECKS) <= set(names)),
            'missing_checks': sorted(set(PASSWORDLESS_CONSOLE_CHECKS)-set(names)),
            'checked_at': report.get('finishedAt'),
        })
    except (OSError, ValueError, KeyError, TypeError, AttributeError, OverflowError):
        behavior['error'] = 'Passwordless console behavior is unavailable or invalid'
    return {'ok': ports_ok and behavior['ok'], 'localhost_bindings': bool(ports_ok),
            'behavior': behavior,
            'scope': 'Project-only published bindings and recorded passwordless UI/CSRF/internal-token checks'}


def probe_management():
    """Current local-session management and renderer inputs plus exercised behavior."""
    try:
        def read(route):
            with urllib.request.urlopen('http://127.0.0.1:19091' + route, timeout=6) as response:
                body = response.read(256 * 1024 + 1)
                if len(body) > 256 * 1024:
                    raise ValueError('Oversized public response')
                return json.loads(body)
        session = read('/api/manage/session')
        services = read('/api/manage/services')
        observer = read('/api/eye/state')
        renderer = read('/api/eye/renderer')
        compatibility = read('/api/eye/compatibility')
        expected = json.loads((PROJECT/'vendor/modern-viewer/mod-assets/compatibility-summary.json').read_text(encoding='utf-8'))
        registration = hashlib.sha256((PROJECT/'server/world-data/block-registry.json').read_bytes()).hexdigest()
        mapping_bytes = (PROJECT/'vendor/modern-viewer/mod-assets/vanilla-state-map.json').read_bytes()
        mapping = json.loads(mapping_bytes)
        deployed_mapping = renderer.get('blockStates', {})
        jar_report = json.loads((PROJECT/'vendor/modern-viewer/mod-assets/compatibility-report.json').read_text(encoding='utf-8'))
        expected_jars = {str(name).replace('\\', '/'): row['sha256'] for row in jar_report['jars'] for name in row['paths']}
        current_jars = {str(p.relative_to(PROJECT)).replace('\\', '/'): p for folder in ('server/mc/mods', 'client/mods') for p in (PROJECT/folder).glob('*.jar')}
        jar_identity = set(current_jars) == set(expected_jars) and all(hashlib.sha256(p.read_bytes()).hexdigest() == expected_jars[name] for name, p in current_jars.items())
        service_rows = services.get('services', [])
        ready = {r.get('id') for r in service_rows if r.get('state') == 'running' and r.get('health') in (None, '', 'healthy')}
        checks = {
            'management_configured': session.get('configured') is True,
            'local_passwordless_session': (session.get('authMode') == 'local'
                and session.get('authenticated') is True
                and isinstance(session.get('csrf'), str) and len(session['csrf']) == 48
                and all(char in '0123456789abcdef' for char in session['csrf'])
                and type(session.get('expiresAt')) in (int, float)
                and math.isfinite(session['expiresAt'])
                and time.time()*1000 < session['expiresAt'] <= (time.time()+3605)*1000),
            'current_services_ready': ready == set(MANIFEST),
            'observer_connected': observer.get('observer', {}).get('online') is True,
            'renderer_stream_ready': renderer.get('ok') is True and renderer.get('observerOnline') is True and renderer.get('worldAvailable') is True,
            'current_mod_assets': compatibility == expected and compatibility.get('registry', {}).get('sha256') == registration,
            'current_mod_jars': jar_identity,
            'current_block_state_mapping': (deployed_mapping.get('ready') is True
                and deployed_mapping.get('registrySha256') == registration == mapping.get('registrySha256')
                and deployed_mapping.get('mappingSha256') == hashlib.sha256(mapping_bytes).hexdigest()
                and deployed_mapping.get('canonicalBlocksSha256') == mapping.get('canonicalBlocksSha256')
                and deployed_mapping.get('vanillaStates') == len(mapping['mappings'])),
            'limits_explicit': compatibility.get('ysmWebPlayback') is False and observer.get('limits', {}).get('remoteInventoryAvailable') is False,
        }
        behavior = probe_recorded_behavior('management-platform-smoke.json', (
            'eye-current-modpack', 'eye-three-views', 'eye-follow-and-park',
            'management-dependency-preview', 'management-execution-receipt', 'management-auth-scope',
            'homepage-responsive', 'renderer-sustained-and-navigation'))
        passwordless = probe_passwordless_consoles()
        recovery = probe_recorded_behavior('management-recovery-smoke.json', (
            'session-first-failure-recovers', 'preview-pending-feedback',
            'preview-single-request', 'no-mutation-replay'))
        return {'ok': all(checks.values()) and behavior['ok'] and passwordless['ok'] and recovery['ok'],
                'checks': checks, 'behavior': behavior, 'passwordless': passwordless, 'recovery': recovery,
                'scope': 'Live observer/stream, current registry and management readiness; rendering evidence is recorded separately'}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return {'ok': False, 'error': 'Management or renderer readiness could not be verified'}


def probe_player_commands():
    """Live deployed service presence plus recorded game behavior under model outage."""
    try:
        heartbeat = json.loads((PROJECT/'server/world-data/world-heartbeat.json').read_text(encoding='utf-8'))
        age = time.time() - heartbeat['ts']/1000
        service = heartbeat.get('playerCommands', {})
        live_ok = (-5 <= age < 180 and isinstance(service, dict)
                   and type(service.get('schema')) is int and service['schema'] == 1
                   and service.get('ready') is True and service.get('queueEnabled') is True
                   and service.get('modelRequired') is False)
        behavior = probe_recorded_behavior('player-service-offline-smoke.json', (
            'model-endpoint-unreachable', 'legacy-myhelp-entry', 'player-status',
            'featured-skills', 'existing-compass-27-slots', 'native-spell-menu'))
        sources = probe_source_record('architecture-current.json')
        return {'ok': live_ok and behavior['ok'] and sources['ok'], 'live': live_ok,
                'age_seconds': round(age, 1), 'behavior': behavior, 'sources': sources,
                'scope': 'Deterministic CLI service; fuzzy chanting and goddess dialogue still require model integration'}
    except (OSError, ValueError, KeyError, TypeError):
        return {'ok': False, 'error': 'Player command heartbeat or verification is unavailable'}


def probe_voice_commands():
    """Current inbox/journal readiness AND recorded ASR-to-spell behavior."""
    age = None
    live_ok = False
    try:
        heartbeat = json.loads((PROJECT/'server/world-data/world-heartbeat.json').read_text(encoding='utf-8'))
        stamp = heartbeat['ts']
        service = heartbeat.get('voiceCommands')
        if type(stamp) in (int, float) and math.isfinite(stamp) and stamp > 0:
            age = time.time() - stamp / 1000
            # Container clocks may lead Windows by a few seconds. A failed
            # receipt journal sets ready=false and cannot be hidden by old QA.
            live_ok = (-5 <= age < 180 and isinstance(service, dict)
                       and type(service.get('schema')) is int and service['schema'] == 1
                       and service.get('ready') is True and service.get('modelRequired') is False)
    except (OSError, ValueError, KeyError, TypeError, AttributeError, OverflowError):
        pass

    filename = 'voice-casting-smoke.json'
    behavior = {'ok': False, 'report': filename}
    try:
        report = json.loads((PROJECT/'reports'/filename).read_text(encoding='utf-8-sig'))
        checks = report.get('checks')
        if not isinstance(checks, list):
            raise ValueError('Missing voice checks')
        passed = {row.get('name') for row in checks if isinstance(row, dict)
                  and isinstance(row.get('name'), str) and row.get('ok') is True}
        cleanup = report.get('cleanup', {})
        behavior.update({
            'ok': (report.get('ok') is True and type(report.get('schema')) is int and report['schema'] == 1
                   and report.get('project') == 'qiandengji' and report.get('customStaff') is True
                   and set(VOICE_SMOKE_CHECKS) <= passed
                   and isinstance(cleanup, dict) and cleanup.get('actorOffline') is True
                   and cleanup.get('lockReleased') is True),
            'missing_checks': sorted(set(VOICE_SMOKE_CHECKS) - passed),
            'custom_staff': report.get('customStaff') is True,
            'checked_at': report.get('finishedAt'),
        })
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        behavior['error'] = 'Voice behavior report is missing or incomplete'
    sources = probe_source_record('architecture-current.json')
    return {'ok': live_ok and behavior['ok'] and sources['ok'], 'live': live_ok,
            'age_seconds': round(age, 1) if age is not None else None,
            'clock_skew_tolerance_seconds': 5, 'behavior': behavior, 'sources': sources,
            'scope': 'Current voice inbox/journal; recorded armed custom-staff TTS/ASR spell execution and replay rejection'}


def probe_chanting_staff():
    """Read-only live item registration plus current gesture-behavior evidence."""
    protocol = {'ok': False, 'container': 'qiandengji-mc-1', 'command': 'qdchant health'}
    try:
        result = subprocess.run(['docker', 'exec', 'qiandengji-mc-1', 'rcon-cli', 'qdchant health'],
                                capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=15)
        if result.returncode or len(result.stdout.encode('utf-8')) > 8192:
            raise ValueError('No bounded successful protocol reply')
        prefix = 'QD_CHANT_JSON '
        lines = [line[len(prefix):] for line in result.stdout.splitlines() if line.startswith(prefix)]
        if len(lines) != 1:
            raise ValueError('Missing or ambiguous protocol envelope')
        value = json.loads(lines[0])
        items = value.get('items')
        protocol['ok'] = (type(value.get('schema')) is int and value['schema'] == 1
                          and value.get('ok') is True and value.get('code') == 'ready'
                          and type(value.get('audioBoundaryProtocol')) is int and value['audioBoundaryProtocol'] == 1
                          and isinstance(items, list) and all(item in items for item in STAFF_ITEMS))
        protocol['audio_boundary_protocol'] = value.get('audioBoundaryProtocol')
        protocol['registered_items'] = [item for item in STAFF_ITEMS if isinstance(items, list) and item in items]
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError, AttributeError):
        # Do not publish raw Docker/RCON stderr or credentials in health output.
        protocol['error'] = 'Independent chanting-item protocol is unavailable or invalid'

    filename = 'chanting-staff-smoke.json'
    behavior = {'ok': False, 'report': filename}
    artifacts = {'ok': False}
    try:
        report = json.loads((PROJECT/'reports'/filename).read_text(encoding='utf-8-sig'))
        checks = report.get('checks')
        if not isinstance(checks, list):
            raise ValueError('Missing staff checks')
        passed = {row.get('name') for row in checks if isinstance(row, dict)
                  and isinstance(row.get('name'), str) and row.get('ok') is True}
        cleanup = report.get('cleanup')
        behavior.update({
            'ok': (report.get('ok') is True and type(report.get('schema')) is int and report['schema'] == 1
                   and report.get('project') == 'qiandengji' and report.get('actor') == 'QDGuildProbe'
                   and set(STAFF_SMOKE_CHECKS) <= passed and isinstance(cleanup, dict)
                   and all(cleanup.get(name) is True for name in ('actorOffline', 'lockReleased', 'clientDisconnected'))),
            'missing_checks': sorted(set(STAFF_SMOKE_CHECKS) - passed), 'checked_at': report.get('finishedAt'),
        })
        mod = report['preflight']['mod']
        name, digest = mod['filename'], mod['sha256']
        if (not isinstance(name, str) or not name.startswith('qiandeng-chanting-') or not name.endswith('.jar')
                or '/' in name or '\\' in name or not isinstance(digest, str) or len(digest) != 64
                or any(character not in '0123456789abcdef' for character in digest)):
            raise ValueError('Invalid tested item artifact')
        paths = [PROJECT/prefix/name for prefix in ('server/mc/mods', 'client/mods')]
        source = 'tools/smoke_chanting_staff.mjs'
        sources_match = (hashlib.sha256((PROJECT/source).read_bytes()).hexdigest() == report['sourceHashes'][source])
        artifacts = {'ok': sources_match and all(path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == digest
                                               for path in paths),
                     'filename': name, 'tested_sha256': digest, 'smoke_source_matches': sources_match}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        behavior['error'] = 'Staff behavior or tested artifact evidence is missing or incomplete'
    sources = probe_source_record('architecture-current.json')
    return {'ok': all(value['ok'] for value in (protocol, behavior, artifacts, sources)),
            'protocol': protocol, 'behavior': behavior, 'artifacts': artifacts, 'sources': sources,
            'supervised_by': 'mc Docker restart policy',
            'scope': 'Live custom-item registration and recorded authoritative gestures; physical microphone/controller remains unverified'}


def probe_voice_recording():
    """Deployed schema-2 recorder identity, without depending on build scratch files."""
    filename = 'recording-build.json'
    sources = probe_source_record(filename)
    try:
        report = json.loads((PROJECT/'reports'/filename).read_text(encoding='utf-8-sig'))
        digest = report.get('sha256')
        previous = report.get('comparison_server_jar_sha256')
        valid_digest = lambda value: isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdef' for c in value)
        if not valid_digest(digest) or not valid_digest(previous):
            raise ValueError('Missing recorder replacement hashes')
        expected_path = 'server/mc/mods/god-voice-0.1.0.jar'
        # These exact D-project destinations are fixed by the build/deployment
        # contract. Report fields must never select an arbitrary file to read.
        paths = (expected_path, 'client/mods/god-voice-0.1.0.jar')
        mismatches = [name for name in paths if not (PROJECT/name).is_file()
                      or hashlib.sha256((PROJECT/name).read_bytes()).hexdigest() != digest]
        rows = report.get('source_files')
        names = {row.get('path') for row in rows if isinstance(row, dict) and isinstance(row.get('path'), str)} if isinstance(rows, list) else set()
        missing_sources = sorted(set(RECORDING_REQUIRED_SOURCES) - names)
        preserved = report.get('unchanged_server_bytecode')
        expected_preserved = RECORDING_PRESERVED_CLASSES
        if report.get('speech_schema') == 2 and report.get('playback_replaced_explicitly') is True:
            expected_preserved = tuple('dev/god/godvoice/' + name + '.class' for name in (
                'GodVoiceLog', 'GodVoiceMod', 'GodVoicePlugin', 'CaptureFence', 'CaptureInterval',
                'MicCapture', 'MicCapture$WavWriter', 'StaffBoundaryListener'))
        preservation_ok = isinstance(preserved, dict) and all(preserved.get(name) is True for name in expected_preserved)
        test = report.get('tests', {}).get('CaptureIntervalTest', {})
        tests_ok = (isinstance(test, dict) and test.get('ok') is True
                    and type(test.get('assertions')) is int and test['assertions'] >= 15)
        schema_ok = (report.get('ok') is True and report.get('mod_id') == 'godvoice'
                     and type(report.get('recording_schema')) is int and report['recording_schema'] == 2
                     and report.get('minecraft') == '1.21.1' and report.get('neoforge') == '21.1.248'
                     and report.get('deployed_path') == expected_path and report.get('recording_allowlist_expanded') is False)
        return {'ok': schema_ok and tests_ok and preservation_ok and sources['ok'] and not mismatches and not missing_sources,
                'report': filename, 'recording_schema': report.get('recording_schema'),
                'previous_sha256': previous, 'current_sha256': digest, 'mismatches': mismatches,
                'missing_sources': missing_sources, 'sources': sources,
                'preserved_recorder_and_entrypoints': preservation_ok, 'capture_interval_tests': tests_ok,
                'playback_replaced_explicitly': report.get('playback_replaced_explicitly') is True,
                'scope': 'Current client/server schema-2 recorder bytes and reviewed build sources; physical SVC capture remains separate'}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return {'ok': False, 'report': filename, 'sources': sources,
                'error': 'Schema-2 recorder deployment evidence is missing or invalid'}


def report_interval_ok(report):
    """Compare actual instants; Z and UTC+08:00 must not be sorted as text."""
    try:
        dates = [datetime.fromisoformat(report[key].replace('Z', '+00:00')) for key in ('startedAt', 'finishedAt')]
        return all(value.tzinfo is not None and value.utcoffset() is not None for value in dates) and dates[0] <= dates[1]
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
        return False


def probe_voice_boundary_deployment():
    """The outer QA owner must restore the exact normal recorder after voice QA."""
    filename = 'voice-boundary-deployment.json'
    try:
        report = json.loads((PROJECT/'reports'/filename).read_text(encoding='utf-8-sig'))
        smoke = json.loads((PROJECT/'reports/voice-casting-smoke.json').read_text(encoding='utf-8-sig'))
        deployment = json.loads((PROJECT/'reports/voice-casting-deployment.json').read_text(encoding='utf-8-sig'))
        if not all(isinstance(value, dict) and report_interval_ok(value) for value in (report, smoke, deployment)):
            raise ValueError('Missing timezone-aware voice QA intervals')
        finished = lambda value: datetime.fromisoformat(value['finishedAt'].replace('Z', '+00:00'))
        after_smoke = finished(report) > finished(smoke)
        after_deployment = finished(report) > finished(deployment)
        digest = report.get('normalRecorderSha256')
        valid_digest = isinstance(digest, str) and len(digest) == 64 and all(c in '0123456789abcdef' for c in digest)
        # Only these fixed project paths may supply current recorder evidence.
        config_bytes = (PROJECT/'server/mc/data/godvoice/config.json').read_bytes()
        config_matches = valid_digest and hashlib.sha256(config_bytes).hexdigest() == digest
        allowlist_exact = json.loads(config_bytes) == {'listen': ['MengMeng']}
        marker = PROJECT/'server/world-data/.qiandengji-recorder-qa.json'
        marker_absent = not marker.exists() and not marker.is_symlink()
        normal_restored = all(report.get(key) is True for key in ('ok', 'restored', 'normalRecorderRestored'))
        dependencies_ok = (smoke.get('ok') is True and deployment.get('ok') is True
                           and deployment.get('restored') is True)
        ok = (type(report.get('schema')) is int and report['schema'] == 1 and report.get('project') == 'qiandengji'
              and normal_restored and config_matches and allowlist_exact and marker_absent
              and dependencies_ok and after_smoke and after_deployment)
        return {'ok': ok, 'report': filename, 'normal_recorder_restored': normal_restored,
                'config_matches': config_matches, 'allowlist_exact': allowlist_exact, 'marker_absent': marker_absent,
                'voice_reports_ok': dependencies_ok, 'after_voice_smoke': after_smoke,
                'after_voice_deployment': after_deployment, 'checked_at': report.get('finishedAt'),
                'scope': 'Exact normal MengMeng recorder configuration restored after the completed software voice QA window'}
    except (OSError, ValueError, KeyError, TypeError, AttributeError, OverflowError):
        return {'ok': False, 'report': filename, 'error': 'Normal recorder restoration evidence is missing or invalid'}


def strict_check_names(report):
    checks = report.get('checks')
    if not isinstance(checks, list):
        raise ValueError('Missing behavior checks')
    return {row.get('name') for row in checks if isinstance(row, dict)
            and isinstance(row.get('name'), str) and row.get('ok') is True}


def probe_skillbar_editor():
    filename = 'skillbar-editor-smoke.json'
    try:
        report = json.loads((PROJECT/'reports'/filename).read_text(encoding='utf-8-sig'))
        missing = sorted(set(EDITOR_SMOKE_CHECKS) - strict_check_names(report))
        digest = report['preflight']['botgateSha256']
        botgate_matches = hashlib.sha256((PROJECT/'server/mc/mods/botgate.jar').read_bytes()).hexdigest() == digest
        source = 'tools/smoke_skillbar_editor.mjs'
        hashes = report['sourceHashes']
        source_matches = isinstance(hashes, dict) and source in hashes
        if source_matches:
            for name, expected in hashes.items():
                path = (PROJECT/name).resolve()
                if not path.is_relative_to(PROJECT.resolve()) or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                    source_matches = False
                    break
        cleanup = report.get('cleanup')
        cleanup_ok = isinstance(cleanup, dict) and all(cleanup.get(key) is True for key in ('clientDisconnected', 'actorOffline', 'lockReleased'))
        restoration = json.loads((PROJECT/'reports/chanting-gameplay-restoration.json').read_text(encoding='utf-8-sig'))
        restored = (restoration.get('ok') is True and restoration.get('restored') is True and report_interval_ok(restoration)
                    and datetime.fromisoformat(restoration['startedAt'].replace('Z', '+00:00')) <= datetime.fromisoformat(report['startedAt'].replace('Z', '+00:00'))
                    and datetime.fromisoformat(restoration['finishedAt'].replace('Z', '+00:00')) >= datetime.fromisoformat(report['finishedAt'].replace('Z', '+00:00')))
        ok = (report.get('ok') is True and type(report.get('schema')) is int and report['schema'] == 1
              and report.get('project') == 'qiandengji' and report.get('actor') == 'QDGuildProbe'
              and report_interval_ok(report) and not missing and botgate_matches and source_matches and cleanup_ok and restored)
        return {'ok': ok, 'report': filename, 'checked_at': report.get('finishedAt'),
                'missing_checks': missing, 'botgate_matches': botgate_matches, 'smoke_source_matches': source_matches,
                'cleanup': cleanup_ok, 'qa_restored': restored,
                'scope': 'Real eight-slot editor behavior with current botgate/source identity and QA restoration'}
    except (OSError, ValueError, TypeError, KeyError, AttributeError, OverflowError):
        return {'ok': False, 'report': filename, 'error': 'Current editor behavior or QA restoration evidence is unavailable'}


def probe_chanting_client():
    filename = 'chanting-client-smoke.json'
    try:
        report = json.loads((PROJECT/'reports'/filename).read_text(encoding='utf-8-sig'))
        missing = sorted(set(CHANTING_CLIENT_CHECKS) - strict_check_names(report))
        digest = report.get('jarSha256')
        paths = ('server/mc/mods/qiandeng-chanting-0.1.0.jar', 'client/mods/qiandeng-chanting-0.1.0.jar')
        mismatches = [name for name in paths if not (PROJECT/name).is_file()
                      or hashlib.sha256((PROJECT/name).read_bytes()).hexdigest() != digest]
        screenshots = report.get('screenshots')
        if not isinstance(screenshots, list) or len(screenshots) != 3:
            raise ValueError('Missing reviewed screenshots')
        screenshot_root = (PROJECT/'client/screenshots').resolve()
        kinds, screenshot_errors = set(), []
        for row in screenshots:
            kind = row['kind']
            if not isinstance(kind, str) or kind in kinds:
                raise ValueError('Duplicate screenshot kind')
            kinds.add(kind)
            path = Path(row['path']).resolve()
            if (not path.is_relative_to(screenshot_root) or path.suffix.lower() != '.png' or not path.is_file()
                    or row.get('visualReviewed') is not True or hashlib.sha256(path.read_bytes()).hexdigest() != row.get('sha256')):
                screenshot_errors.append(kind)
        expected_kinds = {*STAFF_ITEMS, 'skillbar-editor'}
        cleanup = report.get('cleanup')
        cleanup_ok = isinstance(cleanup, dict) and all(cleanup.get(key) is True for key in CHANTING_CLIENT_CLEANUP)
        log = report.get('clientLog')
        log_ok = isinstance(log, dict) and type(log.get('newErrorCount')) is int and log['newErrorCount'] == 0
        ok = (report.get('ok') is True and type(report.get('schema')) is int and report['schema'] == 1
              and report.get('project') == 'qiandengji' and report.get('actor') == 'QiandengTest'
              and report.get('restored') is True and cleanup_ok and report_interval_ok(report)
              and report.get('status') == 'verified' and report.get('visualReview') == 'verified'
              and not missing and not mismatches and kinds == expected_kinds and not screenshot_errors and log_ok)
        return {'ok': ok, 'report': filename, 'checked_at': report.get('finishedAt'),
                'missing_checks': missing, 'jar_mismatches': mismatches, 'screenshot_errors': screenshot_errors,
                'visual_reviewed': report.get('visualReview') == 'verified', 'qa_restored': cleanup_ok and report.get('restored') is True,
                'unverified': report.get('unverified', []),
                'scope': 'Reviewed held-item/editor captures and actual NeoForge startup; physical HUD/controller/microphone remain separate'}
    except (OSError, ValueError, TypeError, KeyError, AttributeError, OverflowError):
        return {'ok': False, 'report': filename, 'error': 'Current client startup, reviewed images or QA restoration evidence is unavailable'}


def operations_time(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError('Operations time requires timezone')
    return parsed.astimezone(timezone.utc)


def load_operations_adapter():
    spec = importlib.util.spec_from_file_location('qiandeng_health_operations', PROJECT/'tools/operations.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def refresh_operations_snapshot():
    """Collect before all other checks, binding this run to its actual snapshot."""
    global OPERATIONS_COLLECTION
    OPERATIONS_COLLECTION = {'ok': False, 'collected': False}
    old_path = list(sys.path)
    target = PROJECT/'server/panel-state/operations.json'
    try:
        # The collector's inventory import must resolve from this project's tools.
        sys.path.insert(0, str(PROJECT/'tools'))
        adapter = load_operations_adapter()
        snapshot = adapter.collect_snapshot(root=PROJECT)
        if (not isinstance(snapshot, dict) or type(snapshot.get('schema')) is not int or snapshot['schema'] != 1
                or snapshot.get('project') != 'qiandengji'
                or not 0 <= time.time() - operations_time(snapshot['generatedAt']).timestamp() <= 300):
            raise ValueError('Collector did not produce a current project snapshot')
        checks = snapshot.get('checks', {})
        shared = checks.get('sharedTts', {})
        core_ok = checks.get('currentServices') is True
        shared_ok = shared.get('ok') is True and shared.get('endpoint') == 'http://127.0.0.1:8100/health'
        adapter.write_snapshot(snapshot, root=PROJECT)
        written = target.read_bytes()
        if json.loads(written) != snapshot:
            raise ValueError('Published operations snapshot differs from this collection')
        OPERATIONS_COLLECTION = {'ok': core_ok and shared_ok, 'collected': True,
            'snapshot_at': snapshot['generatedAt'], 'sha256': hashlib.sha256(written).hexdigest(),
            'current_services': core_ok, 'shared_tts': shared_ok,
            'scope': 'Current service inspection and actual shared TTS health; no inference or lifecycle operation'}
    except Exception as exc:
        OPERATIONS_COLLECTION = {'ok': False, 'collected': False, 'error_type': type(exc).__name__,
            'error': 'Operations collection failed; previous success is not evidence for this check'}
        # Publish the failure itself so a previously green UI snapshot is not
        # presented as a new successful collection. No runtime configuration changes.
        failure = {'schema': 1, 'project': 'qiandengji', 'generatedAt': datetime.now(timezone.utc).isoformat(),
            'runtimes': [], 'agents': [], 'services': [], 'commands': [],
            'issues': [{'code': 'operations-collection', 'severity': 'error', 'title': '运营清单采集失败',
                        'detail': '本次未取得完整状态，不使用旧记录代替当前检查。'}],
            'checks': {'currentServices': False, 'sharedTts': {'ok': False}}}
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_suffix('.health-failed.tmp')
            temporary.write_text(json.dumps(failure, ensure_ascii=False) + '\n', encoding='utf-8')
            temporary.replace(target)
        except OSError:
            OPERATIONS_COLLECTION['publication_failed'] = True
    finally:
        sys.path[:] = old_path
    return dict(OPERATIONS_COLLECTION)


def operations_team_fields_valid(value):
    """Nullable team summaries contain only bounded public fields, never arbitrary objects."""
    def text_valid(item, maximum):
        # JavaScript slices UTF-16 code units; astral characters count as two.
        return isinstance(item, str) and sum(2 if ord(c) > 0xFFFF else 1 for c in item) <= maximum

    def scalar_valid(item, kind):
        if item is None:
            return kind not in ('bool', 'manual', 'role', 'roles', 'role_skills')
        if type(kind) is int:
            return text_valid(item, kind)
        if kind == 'count':
            return type(item) is int and 0 <= item <= 9_007_199_254_740_991
        if kind == 'nonnegative':
            return type(item) in (int, float) and math.isfinite(item) and item >= 0
        if kind in ('bool', 'optional_bool'):
            return type(item) is bool
        if kind in ('manual', 'optional_manual'):
            return item == 'manual'
        if kind == 'optional_today':
            return item == 'today'
        if kind == 'role':
            return isinstance(item, str) and item in OPERATIONS_TEAM_ROLES
        if kind == 'roles':
            return (isinstance(item, list) and len(item) <= 6
                    and all(shape_valid(row, OPERATIONS_ROUND_ROLE_FIELDS) for row in item))
        if kind == 'role_skills':
            return (isinstance(item, dict) and set(item) == set(OPERATIONS_TEAM_ROLES)
                    and all(skills is None or (isinstance(skills, list) and len(skills) <= 12
                        and all(text_valid(skill, 100) for skill in skills)) for skills in item.values()))
        return False

    def shape_valid(item, fields):
        return (isinstance(item, dict) and set(item) == set(fields)
                and all(scalar_valid(item[name], kind) for name, kind in fields.items()))

    return all(value.get(name) is None or shape_valid(value[name], fields)
               for name, fields in OPERATIONS_TEAM_FIELDS.items())


def operations_rows_valid(value):
    """The HTTP projection may expose only this fixed, bounded public schema."""
    for collection, fields in OPERATIONS_FIELDS.items():
        rows = value.get(collection)
        if not isinstance(rows, list) or len(rows) > (200 if collection == 'agents' else 100):
            return False
        for row in rows:
            if not isinstance(row, dict) or set(row) != fields:
                return False
            for name, item in row.items():
                if name == 'dependencies':
                    if not isinstance(item, list) or len(item) > 30 or any(not isinstance(x, str) or len(x) > 64 for x in item):
                        return False
                elif name == 'enabled':
                    if item is not None and type(item) is not bool:
                        return False
                elif name.endswith('Count'):
                    if item is not None and (type(item) is not int or not 0 <= item <= 9_007_199_254_740_991):
                        return False
                elif item is not None and (not isinstance(item, str) or len(item) > (2048 if name == 'endpoint' else 800)):
                    return False
            if collection == 'runtimes' and row['endpoint'] is not None:
                endpoint = urlsplit(row['endpoint'])
                if (endpoint.scheme not in ('http', 'https') or not endpoint.hostname or endpoint.username
                        or endpoint.password or endpoint.query or endpoint.fragment
                        or (endpoint.port is not None and not 1 <= endpoint.port <= 65535)):
                    return False
            if collection == 'issues' and row['severity'] not in (None, 'error', 'warning', 'info'):
                return False
    return operations_team_fields_valid(value)


def probe_operations(value):
    result = {'ok': False, 'scope': 'Current operations projection, owned service checks and required shared TTS dependency'}
    try:
        collection = OPERATIONS_COLLECTION
        if not isinstance(collection, dict) or collection.get('collected') is not True:
            raise ValueError('No successful collection for this health run')
        raw_bytes = (PROJECT/'server/panel-state/operations.json').read_bytes()
        if len(raw_bytes) > 2 * 1024 * 1024 or hashlib.sha256(raw_bytes).hexdigest() != collection['sha256']:
            raise ValueError('Operations file is missing, oversized or changed after collection')
        source = json.loads(raw_bytes)
        stamp = operations_time(source['generatedAt'])
        if source['generatedAt'] != collection['snapshot_at'] or not 0 <= time.time() - stamp.timestamp() <= 300:
            raise ValueError('Operations collection is no longer current')
        fields = {'schema', 'project', 'available', 'generatedAt', 'stale', 'staleReason', 'ageSeconds', 'ttlSeconds',
                  *OPERATIONS_FIELDS, *OPERATIONS_TEAM_FIELDS}
        if not isinstance(value, dict) or set(value) != fields or not operations_rows_valid(value):
            raise ValueError('Invalid or non-public operations projection')
        public_stamp = operations_time(value['generatedAt'])
        # JavaScript normalizes ISO timestamps to milliseconds; the collector
        # preserves Python microseconds. Compare the same millisecond instant.
        matching_time = public_stamp == stamp.replace(microsecond=stamp.microsecond//1000*1000)
        runtime_ids = [row['id'] for row in value['runtimes']]
        runtime_ok = len(runtime_ids) == 4 and set(runtime_ids) == {'qiandengji', 'qiandengji-ops', 'shadow', 'host'}
        agent_ids = [(row['runtimeId'], row['id']) for row in value['agents']]
        agents_ok = (len(agent_ids) == len(set(agent_ids)) and all(rid in runtime_ids and isinstance(aid, str) and aid for rid, aid in agent_ids)
                     and {('qiandengji', 'mc-god'), ('qiandengji', 'mc-herald'), ('qiandengji', 'qd-survivor')} <= set(agent_ids)
                     and {('qiandengji-ops', role) for role in OPERATIONS_TEAM_ROLES} <= set(agent_ids))
        service_ids = [row['id'] for row in value['services']]
        services_ok = (all(isinstance(name, str) and name for name in service_ids) and len(service_ids) == len(set(service_ids))
                       and set(MANIFEST) | {'shared-tts'} <= set(service_ids))
        checks = source.get('checks', {})
        shared = checks.get('sharedTts', {})
        core_ok = checks.get('currentServices') is True
        shared_ok = shared.get('ok') is True and shared.get('endpoint') == 'http://127.0.0.1:8100/health'
        schema_ok = (type(value.get('schema')) is int and value['schema'] == 1 and value['project'] == 'qiandengji'
                     and value['available'] is True and value['stale'] is False and value['staleReason'] is None
                     and type(value['ttlSeconds']) is int and value['ttlSeconds'] == 300
                     and type(value['ageSeconds']) in (int, float) and math.isfinite(value['ageSeconds'])
                     and 0 <= value['ageSeconds'] <= 300 and 0 <= time.time()-public_stamp.timestamp() <= 300)
        result.update({'ok': schema_ok and matching_time and runtime_ok and agents_ok and services_ok and core_ok and shared_ok,
                       'snapshot_at': value['generatedAt'], 'public_schema': schema_ok, 'same_collection': matching_time,
                       'runtimes': runtime_ok, 'agents': agents_ok, 'services': services_ok,
                       'current_services': core_ok, 'shared_tts': shared_ok})
    except (OSError, ValueError, KeyError, TypeError, AttributeError, OverflowError):
        result['error'] = 'Current operations evidence is missing, invalid, stale or not from this collection'
    return result


def probe_panel_http():
    try:
        def read(route):
            with urllib.request.urlopen('http://127.0.0.1:19091' + route, timeout=5) as response:
                return json.load(response)
        health = read('/healthz')
        state = read('/api/state')
        operations = probe_operations(state.get('operations'))
        ok = (health.get('ok') is True and health.get('service') == 'qiandengji-panel'
              and state.get('available') is True and state.get('stale') is False
              and state.get('world', {}).get('stale') is False
              and state.get('npc', {}).get('stale') is False
              and state.get('guild', {}).get('pollingOk') is True
              and state.get('skills', {}).get('available') is True
              and state.get('npc', {}).get('llmEnabled') is False
              and state.get('agent', {}).get('id') not in (None, '', 'unknown'))
        return {'ok': ok and operations['ok'], 'operations': operations, 'url': 'http://127.0.0.1:19091', 'snapshot_at': state.get('generatedAt'),
                'provider': state.get('agent', {}).get('id'), 'scope': 'Live provider identity and current NPC-disabled profile'}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return {'ok': False, 'error': 'Management page or public snapshot unavailable'}


def probe_source_record(filename):
    try:
        record = json.loads((PROJECT/'reports'/filename).read_text(encoding='utf-8'))
        rows = record['source_files']
        if not isinstance(rows, list) or not rows:
            raise ValueError('Missing source inventory')
        bad = []
        for row in rows:
            path = (PROJECT/row['path']).resolve()
            if (not path.is_relative_to(PROJECT.resolve()) or not path.is_file()
                    or hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']):
                bad.append(row['path'])
        return {'ok': record.get('ok') is True and not bad, 'source_file_count': len(rows), 'mismatches': bad}
    except (OSError, ValueError, KeyError, TypeError):
        return {'ok': False, 'error': 'Current source verification unavailable'}


def probe_recorded_behavior(pattern, required_names=(), **required_values):
    paths = sorted((PROJECT / "reports").glob(pattern))
    if not paths:
        return {"ok": False, "error": "No recorded behavior check", "pattern": pattern}
    path = paths[-1]
    try:
        report = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return {"ok": False, "error": "Behavior report is not complete", "report": path.name}
    raw_checks = report.get("checks", [])
    if isinstance(raw_checks, dict):
        names = {name for name, check in raw_checks.items() if isinstance(check, dict) and check.get("ok")}
    else:
        names = {c.get("name") for c in raw_checks if isinstance(c, dict) and c.get("ok")}
    ok = report.get("ok") is True and set(required_names) <= names
    ok = ok and all(report.get(k) == value for k, value in required_values.items())
    return {"ok": ok, "report": path.name,
            "checked_at": report.get("finishedAt", report.get("checked_at"))}


def probe_statusbook():
    path = PROJECT / "reports/npc-trade-runtime.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        ok = (data.get("natural_statusbook_verified") is True and
              data.get("natural_statusbook_world_gave_one") is True and
              data.get("qa", {}).get("ok") is True and data.get("qa_long_command_error_count") == 0)
        return {"ok": ok, "report": path.name, "scope": "Natural first-login status book only"}
    except (OSError, ValueError):
        return {"ok": False, "report": path.name}


def probe_content_files():
    try:
        lock = json.loads((PROJECT/'manifests/content-fixes.lock.json').read_text(encoding='utf-8'))
        checks = []
        for row in lock['files']:
            target = PROJECT/'server/mc/shadow/datapacks/qiandeng_fixes'/row['path']
            checks.append(target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == row['sha256'])
        return {'ok': bool(checks) and all(checks), 'file_count': len(checks),
                'scope': 'Deployed content datapack matches reviewed lock; behavior checked separately'}
    except (OSError, ValueError, KeyError):
        return {'ok': False, 'error': 'Content datapack is missing or differs from the reviewed lock'}


def probe_guild():
    try:
        data = json.loads((PROJECT/'server/mcdata/guild-health.json').read_text(encoding='utf-8'))
        npc = json.loads((PROJECT/'server/mcdata/npc-health.json').read_text(encoding='utf-8'))
        age = time.time() - data['last_success_at']
        # The NPC writes its container clock; the Windows reader can lag a few
        # seconds (measured about 3 s). Keep the raw age visible and reject
        # larger future timestamps, rather than treating every negative age as stale.
        clock_skew_tolerance = 5
        current_date = datetime.now().strftime('%Y-%m-%d')
        consumer_age = time.time() - npc.get('guild_requests_last_poll', 0)
        consumer_ok = (npc.get('guild_requests_enabled') is True
                       and npc.get('threads', {}).get('guild-requests') is True
                       and -clock_skew_tolerance <= consumer_age <= 15)
        npcs = npc.get('guild_npcs', {})
        npc_age = time.time() - npcs.get('checked_at', 0)
        npc_ok = npcs.get('ok') is True and -clock_skew_tolerance <= npc_age <= 100
        ok = (-clock_skew_tolerance <= age < 100 and data.get('error_type') is None and
              data.get('basic_quests') is True and data.get('autogenerate') is False and
              data.get('board_date') == current_date and npc.get('threads', {}).get('guild') is True and consumer_ok and npc_ok)
        return {'ok': ok, 'age_seconds': round(age, 1), 'board_date': data.get('board_date'),
                'clock_skew_tolerance_seconds': clock_skew_tolerance,
                'request_consumer_ok': consumer_ok, 'request_consumer_age_seconds': round(consumer_age, 1),
                'npc_identity_ok': npc_ok, 'npcs_online': npcs.get('online'),
                'npc_states': {r.get('key'): r.get('state') for r in npcs.get('required', [])[:32]},
                'task_counts': data.get('task_counts'), 'scope': 'Supervised guild board and durable request consumer; individual quest outcomes require correlated receipts'}
    except (OSError, ValueError, KeyError, TypeError):
        return {'ok': False, 'error': 'Guild polling evidence is missing or invalid'}


def probe_extension_files():
    try:
        locked = json.loads((PROJECT/'manifests/server-extensions.lock.json').read_text(encoding='utf-8'))['files']
        controller = json.loads((PROJECT/'manifests/controller-support.lock.json').read_text(encoding='utf-8'))['files']
        locked += [{'path': 'client/mods/' + row['filename'], 'sha256': row['sha256']} for row in controller]
        models = json.loads((PROJECT/'manifests/game-models.lock.json').read_text(encoding='utf-8'))['files']
        locked += [{'path': prefix + row['path'], 'sha256': row['sha256']} for row in models for prefix in ['client/', 'server/mc/']]
        bad = []
        for row in locked:
            path = (PROJECT/row['path']).resolve()
            if not path.is_relative_to(PROJECT.resolve()) or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']:
                bad.append(row['path'])
        return {'ok': not bad, 'file_count': len(locked), 'mismatches': bad}
    except (OSError, ValueError, KeyError, TypeError):
        return {'ok': False, 'error': 'Extension file locks unavailable or invalid'}


def probe_architecture():
    try:
        record_path = PROJECT/'reports/architecture-current.json'
        record = json.loads(record_path.read_text(encoding='utf-8'))
        rows = record['source_files']
        if not isinstance(rows, list) or not rows:
            raise ValueError('Missing source inventory')
        bad = []
        for row in rows:
            path = (PROJECT/row['path']).resolve()
            if (not path.is_relative_to(PROJECT.resolve()) or not path.is_file()
                    or hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']):
                bad.append(row['path'])
        live = probe_recorded_behavior('architecture-live-smoke.json', (
            'legacy-myhelp-entry', 'featured-skills-through-new-modules',
            'existing-compass-27-slots', 'guild-board-reply', 'legacy-task-claim-refused'))
        return {'ok': record.get('ok') is True and not bad and live['ok'],
                'source_file_count': len(rows), 'mismatches': bad, 'live': live,
                'scope': 'Refactored source identity and actual player commands/menu/guild; no new Agent or contract system'}
    except (OSError, ValueError, KeyError, TypeError):
        return {'ok': False, 'error': 'Architecture regression evidence unavailable or invalid'}


def probe_character_speech():
    try:
        spec = importlib.util.spec_from_file_location('qd_character_speech_health', PROJECT / 'tools/character_speech_health.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        live = module.check(PROJECT)
        behavior = probe_recorded_behavior('character-speech-smoke.json', (
            'native-speech-tools', 'actor-voice-isolation', 'lease-bound-speech',
            'late-synthesis-cancelled', 'playback-queue-contract', 'local-audio-decoder'))
        return {'ok': live['ok'] and behavior['ok'], 'live': live, 'behavior': behavior,
                'scope': 'Current playback protocol and exercised speech boundaries; audible client output remains separate'}
    except (OSError, ValueError, AttributeError, ImportError):
        return {'ok': False, 'error': 'Character speech probe unavailable'}


def probe_maid_bridge():
    try:
        spec = importlib.util.spec_from_file_location('qd_maid_bridge_health', PROJECT / 'tools/maid_bridge_health.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        result = module.check(PROJECT)
        return {**result, 'supervised_by': 'Minecraft and NPC Docker restart policies',
            'scope': 'Live signed bridge and registered identities; original unloaded characters remain dormant. Native actions tested in a separate world.'}
    except (OSError, ValueError, AttributeError, ImportError):
        return {'ok': False, 'error': 'Maid bridge probe unavailable'}


def probe_agent_learning():
    """Recorded real MCP checks stay separate from model learning outcomes."""
    try:
        audit = json.loads((PROJECT / 'reports/agent-runtime-audit.json').read_text('utf8'))
        smoke = json.loads((PROJECT / 'reports/agent-learning-smoke.json').read_text('utf8'))
        source_ok = bool(audit.get('sourceHashes')) and all(
            (PROJECT / path).resolve().is_relative_to(PROJECT.resolve())
            and hashlib.sha256((PROJECT / path).read_bytes()).hexdigest() == digest
            for path, digest in audit.get('sourceHashes', {}).items())
        return {'ok': audit.get('ok') is True and smoke.get('ok') is True and source_ok,
            'nativeMcpSmoke': smoke.get('ok') is True, 'sourceCurrent': source_ok,
            'supervisedBy': 'QwenPaw native runtime and Docker restart policies',
            'scope': 'Skills, native schedules and actual MCP protocol; model learning outcomes require separate evidence.'}
    except (OSError, ValueError, KeyError, TypeError):
        return {'ok': False, 'error': 'Agent learning evidence unavailable'}


def probe_game_knowledge():
    try:
        spec = importlib.util.spec_from_file_location('qd_game_knowledge_health', PROJECT / 'tools/game_knowledge_health.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.check(PROJECT)
    except Exception as exc:
        return {'ok': False, 'errorType': type(exc).__name__, 'error': 'Game knowledge reference or recipe tool unavailable'}


def main_locked():
    operations = refresh_operations_snapshot()
    report = {"checked_at": datetime.now(timezone.utc).isoformat(), "project": "qiandengji",
              "operations_inventory": operations,
              "services": probe_services(), "skill_compass": probe_recorded_behavior("skill-compass-smoke.json"),
              "npc_book": probe_recorded_behavior("npc-smoke-*.json", ("botgate-book-request", "npc-light-effect", "client-tellraw"), bookInteractionVerified=True),
              "goddess_chat": probe_recorded_behavior("goddess-smoke.json"),
              "goddess_models": probe_recorded_behavior("qwenpaw-smoke.json"),
              "maid_model": probe_recorded_behavior("maid-model-smoke.json"),
              "modded_client": probe_recorded_behavior("client-runtime.json"),
              "cosmetic_assets": probe_recorded_behavior("cosmetic-assets-health.json", voice_pack_count=18, skin_registry_repaired=True),
              "character_skins": probe_recorded_behavior("character-skins-smoke.json"),
              "game_models": probe_recorded_behavior("game-models-smoke.json"),
              "character_models": probe_recorded_behavior("character-model-bindings.json", registryChanged=False, charactersSpawned=False),
              "controller": probe_recorded_behavior("controller-support-health.json"),
              "controller_visual": probe_recorded_behavior("controller-visual.json"),
              "native_spell_bridge": probe_recorded_behavior("irons-bridge-smoke.json"),
              "waypoint_travel": probe_recorded_behavior("waypoint-travel-smoke.json"),
              "skill_compass_visual": probe_recorded_behavior("skill-compass-visual.json"),
              "cli_feedback": probe_recorded_behavior("cli-feedback-smoke.json"),
              "native_menu_visual": probe_recorded_behavior("native-menu-visual.json"),
              "extension_files": probe_extension_files(),
              "architecture": probe_architecture(),
              "panel_smoke": probe_panel_smoke(),
              "entry_points": probe_recorded_behavior("mc-endpoints.json"),
              "rcon_protocol": probe_recorded_behavior("rcon-live-smoke.json"),
              "statusbook": probe_statusbook(),
              "content_files": probe_content_files(),
              "guild": probe_guild(),
              "guild_board": probe_recorded_behavior("guild-board-smoke.json", ("guild-board-reply", "legacy-task-pause-visible")),
              "exploration_rewards": probe_recorded_behavior("content-fixes-smoke.json", (
                  "content-datapack-enabled", "anthill-loot-generated", "assassin-loot-generated",
                  "advancement:find_thornborn_towers", "advancement:find_fishing_hut", "exploration-position-parser")),
              "voice_inference": probe_recorded_behavior("voice-inference-*.json"),
              "character_speech": probe_character_speech(), "maid_bridge": probe_maid_bridge(),
              "agent_learning": probe_agent_learning(), "game_knowledge": probe_game_knowledge(),
              "world_operations": probe_world_operations(), "numen_autonomy": probe_numen_autonomy(),
              "world_team": probe_world_team()}
    report["ok"] = all(v["ok"] for v in report.values() if isinstance(v, dict) and "ok" in v)
    report["scope"] = "Service readiness and the exercised core gameplay paths; not an exhaustive content audit"
    report["unverified"] = ["Legacy NPC trade profiles", "Physical controller input", "Physical microphone input and audible playback", "Agent offscreen WebGL visual perception", "Dormant original character bodies in live play (model appearance verified on temporary Numen bodies)"]
    output = PROJECT / "reports" / "runtime-health.json"
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    public = PROJECT / 'server' / 'panel-state'
    public.mkdir(parents=True, exist_ok=True)
    public_services = {**report['services'].get('checks', {}), 'shared-tts': {
        'ok': operations.get('shared_tts') is True, 'state': 'observed' if operations.get('collected') else 'unknown',
        'health': 'healthy' if operations.get('shared_tts') is True else 'unavailable',
        'purpose': 'D owned TTS on port 8100; compatibility endpoint for voice replies'}}
    public_report = {'checked_at': report['checked_at'], 'ok': report['services']['ok'] and operations['ok'],
                     'services': public_services}
    temporary = public / 'health.tmp'
    temporary.write_text(json.dumps(public_report, ensure_ascii=False) + '\n', encoding='utf-8')
    temporary.replace(public / 'health.json')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 1


def load_inventory_lock():
    spec = importlib.util.spec_from_file_location('health_inventory_lock', PROJECT/'tools/operations_inventory_lock.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.inventory_lock


def inventory_lock_failure(reason):
    """A blocked verification is current failure, never the previous green run."""
    global OPERATIONS_COLLECTION
    OPERATIONS_COLLECTION = {'ok': False, 'collected': False, 'reason': reason, 'retry': True}
    report = {'checked_at': datetime.now(timezone.utc).isoformat(), 'project': 'qiandengji', 'ok': False,
              'operations_inventory': dict(OPERATIONS_COLLECTION),
              'scope': 'Inventory verification could not acquire its publication window; retry required'}
    public = {'checked_at': report['checked_at'], 'ok': False, 'services': {}, 'reason': reason, 'retry': True}
    for target, value in ((PROJECT/'reports/runtime-health.json', report),
                          (PROJECT/'server/panel-state/health.json', public)):
        temporary = None
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=target.parent,
                                             prefix=target.name+'.', suffix='.tmp', delete=False) as handle:
                temporary = Path(handle.name)
                handle.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
            temporary.replace(target)
        except OSError:
            report['publication_failed'] = True
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1


def main():
    # Hold through the HTTP read and report publication, not just collection:
    # the panel must still expose this run's exact snapshot receipt.
    try:
        lock = load_inventory_lock()
        with lock(PROJECT, wait_seconds=10) as acquired:
            if not acquired:
                return inventory_lock_failure('inventory_busy')
            return main_locked()
    except (OSError, ImportError, AttributeError, ValueError, TypeError):
        return inventory_lock_failure('inventory_lock_unavailable')


if __name__ == "__main__":
    sys.exit(main())
