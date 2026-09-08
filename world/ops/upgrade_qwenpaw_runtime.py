"""Explicit offline migration of the existing game runtime to QwenPaw 2.2.0.

Run with --apply, /state mounted from a stopped and backed-up game runtime,
and Docker --network none. Never use the old initializer on existing state.
"""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import socket
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from llm_runtime_policy import unrestricted_running, validate_running

STATE = Path('/state')
VERSION = '2.2.0'
ROLES = {'mc-god', 'mc-herald'}
DISABLED = {'default', 'QwenPaw_QA_Agent_0.2'}


def defaults_under(original, defaults):
    """Add schema defaults without dropping unknown or user-edited fields."""
    result = deepcopy(defaults)
    for key, value in original.items():
        result[key] = (defaults_under(value, result[key])
                       if isinstance(value, dict) and isinstance(result.get(key), dict)
                       else deepcopy(value))
    return result


def pause_background(running):
    # Keep retry/context choices; scoped runtimes use the explicit quota-off policy.
    running['light_context_config']['strategy'] = 'native'
    running['light_context_config']['visual_compact_config']['enabled'] = False
    running['auto_title_config']['enabled'] = False
    memory = running['reme_light_memory_config']
    for key in ('memory_search_enabled', 'dream_cron_enabled', 'daily_paper_cron_enabled',
                'auto_memory_inbox_push_enabled', 'auto_dream_inbox_push_enabled',
                'daily_paper_inbox_push_enabled', 'inbox_push_enabled'):
        if key in memory:
            memory[key] = False
    memory['auto_memory_interval'] = 0
    memory['auto_memory_search_config']['enabled'] = False
    running.update(unrestricted_running(running))


def assert_quiet(running):
    assert running['light_context_config']['strategy'] == 'native'
    assert running['light_context_config']['visual_compact_config']['enabled'] is False
    assert running['auto_title_config']['enabled'] is False
    memory = running['reme_light_memory_config']
    for key in ('memory_search_enabled', 'dream_cron_enabled', 'daily_paper_cron_enabled',
                'auto_memory_inbox_push_enabled', 'auto_dream_inbox_push_enabled',
                'daily_paper_inbox_push_enabled'):
        assert memory[key] is False
    assert memory['auto_memory_interval'] == 0
    assert memory['auto_memory_search_config']['enabled'] is False
    validate_running(running)


def assert_generation_settings_preserved(before, after):
    """Quota-off is explicit; retry, timeout, context and legacy values stay put."""
    expected = unrestricted_running(before)
    for key in before:
        if key.startswith('llm_') or key in ('max_iters', 'max_input_length'):
            assert after[key] == expected[key]
    assert after['loop']['iteration'] == expected['loop']['iteration']


def closed_surface(value, builtin_names):
    assert not value['mcp']['clients'], 'Unexpected existing MCP configuration'
    value['mcp']['clients'] = {}
    for item in value['tools']['builtin_tools'].values():
        item['enabled'] = False
    for item in value['acp']['agents'].values():
        item['enabled'] = False
    guard = value['security']['tool_guard']
    guard['denied_tools'] = sorted(set(guard['denied_tools']) | set(builtin_names))
    assert not value['security']['allow_no_auth_hosts']


def tree_digest(state, exclusions):
    return {p.relative_to(state).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in state.rglob('*') if p.is_file() and p not in exclusions}


def driver_cards(folder):
    # QwenPaw writes a hidden migration receipt even when there are no drivers.
    return [p for p in (folder/'drivers').glob('**/*.yaml')
            if p.name != '.legacy_mcp_migration_report.yaml']


def upgrade():
    from qwenpaw.config.config import Config, AgentProfileConfig
    from qwenpaw.constant import WORKING_DIR, SECRET_DIR
    assert importlib.metadata.version('qwenpaw') == VERSION
    assert Path(WORKING_DIR) == STATE/'work' and Path(SECRET_DIR) == STATE/'secret'
    assert {name for _, name in socket.if_nameindex()} == {'lo'}, 'Use --network none'
    manifest = json.loads((STATE/'init-manifest.json').read_text())
    assert manifest['project'] == 'qiandengji'
    assert {p['id'] for p in manifest['profiles']} == ROLES
    config_path = STATE/'work/config.json'
    original = json.loads(config_path.read_text())
    refs = original['agents']['profiles']
    assert set(refs) == ROLES | DISABLED
    assert {aid for aid, ref in refs.items() if ref['enabled']} == ROLES
    assert not original.get('plugins') and not original.get('skill_paths')
    config = defaults_under(original, Config().model_dump(mode='json', exclude_none=True))
    # Empty legacy clients must remain empty instead of inheriting a new template.
    config['mcp']['clients'] = deepcopy(original['mcp']['clients'])
    builtin_names = set(config['tools']['builtin_tools'])
    closed_surface(config, builtin_names)
    pause_background(config['agents']['running'])
    Config.model_validate(config)
    pending = {config_path: config}
    rows = []
    for aid, ref in refs.items():
        folder = STATE/'work/workspaces'/aid
        assert Path(ref['workspace_dir']) == folder and folder.resolve() == folder
        path = folder/'agent.json'
        before = json.loads(path.read_text())
        assert before['id'] == aid and Path(before['workspace_dir']) == folder
        profile = defaults_under(before, AgentProfileConfig(id=aid, name=before['name'],
            tools=config['tools'], acp=config['acp'], security=config['security']).model_dump(mode='json', exclude_none=True))
        profile['mcp']['clients'] = deepcopy(before['mcp']['clients'])
        assert not before.get('fallback_models') and not before.get('fallback_policy', {}).get('enabled')
        profile['fallback_models'] = []
        profile['fallback_policy']['enabled'] = False
        profile['heartbeat']['enabled'] = False
        closed_surface(profile, builtin_names)
        pause_background(profile['running'])
        assert profile.get('active_model') == before.get('active_model')
        assert_generation_settings_preserved(before['running'], profile['running'])
        assert_quiet(profile['running'])
        AgentProfileConfig.model_validate(profile)
        if aid in ROLES:
            # Existing game roles expose no driver or skill tools. Do not silently
            # remove a user's additions; stop migration if this boundary changed.
            assert not driver_cards(folder)
            assert not list((folder/'active_skills').glob('*/SKILL.md'))
            assert not list((folder/'skills').glob('*/SKILL.md'))
            jobs = folder/'jobs.json'
            assert not jobs.exists() or not json.loads(jobs.read_text())['jobs']
        pending[path] = profile
        rows.append({'id': aid, 'enabled': ref['enabled'], 'modelsPreserved': True,
                     'generationLimitsPreserved': True, 'backgroundTasks': False})
    report_path = STATE/'upgrade-report.json'
    unchanged = tree_digest(STATE, set(pending) | {report_path})
    # All paths and schemas pass before any original config is replaced.
    for path, value in pending.items():
        temporary = path.with_name(path.name+'.upgrade-tmp')
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        temporary.chmod(0o600)
        temporary.replace(path)
    assert tree_digest(STATE, set(pending) | {report_path}) == unchanged
    report = {'schema': 1, 'project': 'qiandengji', 'ok': True,
        'generatedAt': datetime.now(timezone.utc).isoformat(), 'packageVersion': VERSION,
        'network': 'none', 'profiles': rows, 'preservedFiles': len(unchanged),
        'credentialsIdentitySessionsPreserved': True, 'builtinTools': 0,
        'newAutomaticTasks': 0, 'modelRequests': 0}
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    report_path.chmod(0o600)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', required=True)
    parser.parse_args()
    try:
        upgrade()
    except Exception as exc:
        print(json.dumps({'project': 'qiandengji', 'ok': False, 'errorType': type(exc).__name__}))
        raise SystemExit(1)
