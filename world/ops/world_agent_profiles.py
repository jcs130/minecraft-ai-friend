"""Shared, credential-free contract for the text-only game-world roles."""
from copy import deepcopy
from role_learning_profiles import with_learning, validate_learning_profile, validate_learning_workspace

WORLD_ROLES = ('qd-villager-dialogue', 'qd-guild-planner', 'qd-maid-dialogue')
GAME_ROLES = {'mc-god', 'mc-herald', 'qd-survivor', *WORLD_ROLES}
LABELS = {'qd-villager-dialogue': '村民对话', 'qd-guild-planner': '公会任务策划', 'qd-maid-dialogue': '女仆对话'}
DESCRIPTIONS = {'qd-villager-dialogue': '按真实村民身份与观察生成短对话，不执行世界动作。',
                'qd-guild-planner': '依据已绑定NPC与资源约束生成可校验的合同JSON草案，不发放奖励。',
                'qd-maid-dialogue': '按当前女仆设定与上下文生成对话，不控制身体或调用外部工具。'}


def disabled(value):
    if isinstance(value, dict):
        return {key: False if key == 'enabled' else disabled(item) for key, item in value.items()}
    if isinstance(value, list):
        return [disabled(item) for item in value]
    return deepcopy(value)


def closed_profile(original, role, learning=True):
    if role not in WORLD_ROLES:
        raise ValueError('unknown_world_role')
    result = deepcopy(original)
    result.update(id=role, name=LABELS[role], description=DESCRIPTIONS[role],
                  workspace_dir='/state/work/workspaces/' + role, backend='qwenpaw', backend_settings={},
                  system_prompt_files=['AGENTS.md', 'SOUL.md', 'PROFILE.md'], thinking_level='off', language='zh',
                  fallback_models=[], mcp={'clients': {}}, heartbeat={'enabled': False})
    for key in ('last_dispatch', 'project_dir', 'template_id', 'subagent_model'):
        result.pop(key, None)
    for key in ('tools', 'acp', 'plan', 'coding_mode', 'llm_routing', 'fallback_policy'):
        result[key] = disabled(result.get(key, {}))
    result['fallback_policy']['enabled'] = False
    result['plan']['enabled'] = result['coding_mode']['enabled'] = False
    result['channels'] = disabled(result.get('channels', {}))
    if isinstance(result['channels'].get('console'), dict):
        result['channels']['console']['enabled'] = True
    running = result['running']
    iterations = 3 if learning else 1
    running.update(max_iters=iterations, max_input_length=12000, llm_retry_enabled=False, llm_max_retries=1,
                   llm_max_concurrent=1, llm_max_qpm=4)
    running['loop']['iteration'].update(enabled=True, max_iterations=iterations)
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
    guard = result['security']['tool_guard']
    guard['denied_tools'] = sorted(set(guard.get('denied_tools', [])) | set(result['tools']['builtin_tools']))
    if learning:
        result = with_learning(result, role, 'game')
    validate_profile(result, role, learning=learning)
    return result


def validate_profile(agent, role, learning=True):
    from upgrade_qwenpaw_runtime import assert_quiet
    assert role in WORLD_ROLES and agent['id'] == role and agent['name'] == LABELS[role]
    assert agent['workspace_dir'] == '/state/work/workspaces/' + role
    assert agent['backend'] == 'qwenpaw' and not agent.get('backend_settings')
    assert agent['thinking_level'] == 'off'
    assert agent['system_prompt_files'] == ['AGENTS.md', 'SOUL.md', 'PROFILE.md']
    assert set(agent['mcp']['clients']) == ({'qd_learning'} if learning else set()) and agent['heartbeat']['enabled'] is False
    if learning:
        validate_learning_profile(agent, role, 'game')
    assert not agent['fallback_models'] and agent['fallback_policy']['enabled'] is False
    for group in ((agent['acp']['agents'],) if learning else (agent['tools']['builtin_tools'], agent['acp']['agents'])):
        assert not any(item.get('enabled') for item in group.values())
    assert not agent['plan']['enabled'] and not agent['coding_mode']['enabled']
    assert agent.get('llm_routing', {}) == disabled(agent.get('llm_routing', {}))
    for channel, settings in agent.get('channels', {}).items():
        if channel != 'console':
            assert settings == disabled(settings)
    assert not agent['security']['allow_no_auth_hosts']
    assert_quiet(agent['running'])
    running = agent['running']
    assert running['max_iters'] == (3 if learning else 1) and running['max_input_length'] == 12000
    assert running['llm_max_concurrent'] == 1 and running['llm_max_qpm'] == 4
    assert running['llm_retry_enabled'] is False and running['llm_max_retries'] == 1
    assert running['reme_light_memory_config'].get('inbox_push_enabled', False) is False
    active = agent['active_model']
    assert isinstance(active.get('provider_id'), str) and active['provider_id']
    assert isinstance(active.get('model'), str) and active['model']


def validate_workspace(folder, role, learning=True):
    import json
    from upgrade_qwenpaw_runtime import driver_cards
    agent = json.loads((folder / 'agent.json').read_text(encoding='utf-8'))
    validate_profile(agent, role, learning=learning)
    assert driver_cards(folder) == ([folder / 'drivers/mcp/qd_learning.yaml'] if learning else [])
    if learning:
        validate_learning_workspace(folder, role, 'game')
    else:
        assert not json.loads((folder / 'jobs.json').read_text())['jobs']
        assert not any(row.get('enabled') for row in json.loads((folder / 'skill.json').read_text())['skills'].values())
    return agent
