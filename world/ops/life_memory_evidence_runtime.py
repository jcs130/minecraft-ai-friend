"""Scoped ReMe extension hooks; no new model, loop, schedule or memory backend.

The pinned native auto-memory renderer drops tool blocks. ReMe explicitly
supports overriding _format_history and registering alternate step backends.
Only the two verified life workspaces select these new backend names.
"""
from copy import deepcopy
import hashlib
import importlib.metadata
import inspect

from life_memory_evidence import VERSION, POLICY, canonical, capabilities, evidence_prompt

BACKENDS = {'auto_memory_step': 'qiandeng_life_auto_memory_step',
            'dream_extract_step': 'qiandeng_life_dream_extract_step',
            'dream_integrate_step': 'qiandeng_life_dream_integrate_step'}
CONTRACT = {
    'config': '322920851f0670d3f8db54e4b436a9b41e7519e3e9a53bb63d685a263720fb9d',
}
_MARKER = '_qiandeng_life_memory_evidence'


def member_for(role, workspace, members=None):
    from party_role_capabilities import party_members, YUI_AGENT_ID, YUI_BODY_UUID, SURVIVOR_BODY_UUID
    if members is None:
        members = party_members()
    expected = {('qd-survivor', SURVIVOR_BODY_UUID, 'survivor'), (YUI_AGENT_ID, YUI_BODY_UUID, 'maid')}
    if {(m['agentId'], m['bodyUuid'], m['kind']) for m in members} != expected:
        return None
    matches = [m for m in members if m['agentId'] == role]
    if len(matches) != 1 or str(workspace) != '/state/work/workspaces/' + role:
        return None
    return matches[0]


def configure(config, member):
    """Change step selection only; credentials/providers/jobs remain original."""
    result = deepcopy(config)
    seen = set()
    for job in result.get('jobs', {}).values():
        for step in job.get('steps', []):
            backend = step.get('backend')
            if backend in BACKENDS:
                step['backend'] = BACKENDS[backend]
                step['qiandeng_body_uuid'] = member['bodyUuid']
                seen.add(backend)
    if seen != set(BACKENDS):
        raise ValueError('review_new_life_memory_job_contract')
    return result


def _register():
    from reme.steps.evolve.auto_memory import AutoMemoryStep
    from reme.steps.evolve.dream.extract import DreamExtractStep
    from reme.steps.evolve.dream.integrate import DreamIntegrateStep

    class EvidencePrompts:
        def __init__(self, qiandeng_body_uuid='', **kwargs):
            self.qiandeng_body_uuid = qiandeng_body_uuid
            super().__init__(**kwargs)

        def prompt_format(self, prompt_name, **kwargs):
            original = super().prompt_format(prompt_name, **kwargs)
            if 'system_prompt' not in prompt_name:
                return original
            workspace = self.file_store.workspace_path
            return original + POLICY + '\n当前接口事实（不是行动/既有成果）：\n' + canonical(capabilities(workspace)).decode('utf-8')

    class LifeAutoMemory(EvidencePrompts, AutoMemoryStep):
        def _format_history(self, messages):
            # Native formatted text remains verbatim; append only the bounded
            # exact tool projection and its immutable, read-only source link.
            return super()._format_history(messages) + '\n\n' + evidence_prompt(
                messages, self.qiandeng_body_uuid, self.file_store.workspace_path)

    class LifeDreamExtract(EvidencePrompts, DreamExtractStep):
        pass

    class LifeDreamIntegrate(EvidencePrompts, DreamIntegrateStep):
        pass

    return LifeAutoMemory, LifeDreamExtract, LifeDreamIntegrate


def install(runtime):
    """Install before Qwen workspaces initialize; never rewrite site-packages."""
    if runtime == 'operations':
        return 0
    if runtime != 'game':
        raise ValueError('invalid_life_memory_runtime')
    if (importlib.metadata.version('qwenpaw'), importlib.metadata.version('reme-ai')) != ('2.2.0', '0.4.1.10'):
        raise ValueError('review_new_life_memory_versions')
    from qwenpaw.agents.memory import reme_light_memory_manager as manager
    original = manager.get_reme_app_config
    if getattr(original, _MARKER, None) == VERSION:
        return VERSION
    if hashlib.sha256(inspect.getsource(original).encode()).hexdigest() != CONTRACT['config']:
        raise ValueError('review_new_life_memory_config_factory')
    classes = _register()
    from reme import application
    resolve = application.resolve_plugin_runtime

    def local_registry(application_config):
        value = resolve(application_config)
        workspace = application_config.get('workspace_dir', '')
        role = str(workspace).rsplit('/', 1)[-1]
        if member_for(role, workspace):
            for name, cls in zip(BACKENDS.values(), classes):
                value.registry.add(name, cls, owner='qiandeng-life-memory-evidence-v1')
        return value

    def app_config(*, working_dir, agent_config, user_timezone=None):
        config = original(working_dir=working_dir, agent_config=agent_config, user_timezone=user_timezone)
        member = member_for(agent_config.id, working_dir)
        return configure(config, member) if member else config

    setattr(app_config, _MARKER, VERSION)
    application.resolve_plugin_runtime = local_registry
    manager.get_reme_app_config = app_config
    return VERSION
