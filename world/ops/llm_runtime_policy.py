"""Project-owned Qwen 2.2 policy: no artificial QPM or iteration quota.

Qwen's disabled iteration gate does not disable AgentScope's separate cap.
The process-local adapter honors that native switch for Qwen agents only; it
uses mathematical infinity during the synchronous next-action decision and
restores the serializable native config before any model/tool work starts.
"""
from copy import deepcopy
from functools import wraps
import inspect
import math

VERSION = 1
SUMMARY_VERSION = 1
SUMMARY_SOURCE_SHA256 = '08c38de303daf3c82f84dea8a2c770ef2f43e8c67171df4fe998317dde7b6954'


def unrestricted_running(running):
    """Disable request quotas and keep one native model call in flight."""
    value = deepcopy(running)
    value['llm_max_qpm'] = 0  # Native RateLimiter: zero bypasses only QPM.
    value['llm_max_concurrent'] = 1
    value.setdefault('loop', {}).setdefault('iteration', {}).update(
        enabled=False, max_iterations=None)
    return value


def disable_limits(running):
    """The same policy for Qwen's native Pydantic running-config object."""
    running.llm_max_qpm = 0
    running.llm_max_concurrent = 1
    running.loop.iteration.enabled = False
    running.loop.iteration.max_iterations = None


def validate_running(running):
    if not isinstance(running, dict):
        running = running.model_dump(mode='json') if hasattr(running, 'model_dump') else {
            'max_iters': running.max_iters, 'llm_max_qpm': running.llm_max_qpm,
            'llm_max_concurrent': running.llm_max_concurrent,
            'loop': {'iteration': vars(running.loop.iteration)}}
    assert type(running['max_iters']) is int and running['max_iters'] >= 1
    assert running['llm_max_concurrent'] == 1
    assert type(running['llm_max_qpm']) is int and running['llm_max_qpm'] == 0
    iteration = running['loop']['iteration']
    assert iteration['enabled'] is False and iteration.get('max_iterations') is None


def wrap_next_action(original):
    @wraps(original)
    def next_action(self, final_msg=None):
        iteration = self._agent_config.running.loop.iteration
        if iteration.enabled is not False:
            return original(self, final_msg)
        saved = self.react_config
        # model_copy deliberately supplies an internal numeric sentinel; no
        # JSON Infinity, persisted fake limit, reset iteration count or copied
        # permission/exit implementation is involved.
        self.react_config = saved.model_copy(update={'max_iters': math.inf})
        try:
            return original(self, final_msg)
        finally:
            self.react_config = saved
    return next_action


def home_summary_model(agent):
    """Only the configured home provider has a fixed reasoning effort."""
    slot = getattr(getattr(agent, '_agent_config', None), 'active_model', None)
    return getattr(slot, 'provider_id', None) == 'home_llm'


def wrap_plain_summary(original):
    """Avoid enable_thinking=false, which conflicts with the home gateway's reasoning_effort."""
    @wraps(original)
    async def generate(self, agent, prompt, *, max_tokens, language='en'):
        if not home_summary_model(agent):
            return await original(self, agent, prompt, max_tokens=max_tokens, language=language)
        model = getattr(agent, 'model', None)
        if not callable(model):
            return ''
        response = await model(messages=self._summary_messages(prompt, language),
                               tools=None, max_tokens=max_tokens)
        if not inspect.isasyncgen(response):
            self._raise_if_summary_interrupted(response)
            return self._response_text(response)
        deltas = []
        final = ''
        async for chunk in response:
            self._raise_if_summary_interrupted(chunk)
            value = self._response_text(chunk)
            if getattr(chunk, 'is_last', False):
                final = value
            elif value:
                deltas.append(value)
        return final or ''.join(deltas).strip()
    return generate


def install_home_summary():
    """Patch only the reviewed QwenPaw 2.2.1 scroll summary entry point."""
    from qwenpaw_runtime_contract import release
    version = release()
    if version == '2.2.0':
        return 0
    if version != '2.2.1':
        raise ValueError('review_new_qwen_summary_release')
    from qwenpaw.agents.context.scroll.manager import ScrollContextManager
    original = ScrollContextManager._generate_plain_summary
    if getattr(ScrollContextManager, '_qiandeng_home_summary', None) == SUMMARY_VERSION:
        return SUMMARY_VERSION
    import hashlib
    if hashlib.sha256(inspect.getsource(original).encode()).hexdigest() != SUMMARY_SOURCE_SHA256:
        raise ValueError('review_new_qwen_summary_source')
    ScrollContextManager._generate_plain_summary = wrap_plain_summary(original)
    ScrollContextManager._qiandeng_home_summary = SUMMARY_VERSION
    return SUMMARY_VERSION


def install(runtime):
    if runtime not in ('game', 'operations'):
        raise ValueError('invalid_llm_policy_runtime')
    from qwenpaw_runtime_contract import verify_sources, verify_callable
    verify_sources('agent')
    from qwenpaw.agents.react_agent import QwenPawAgent
    from agentscope.agent import Agent
    if getattr(QwenPawAgent, '_qiandeng_llm_policy', None) == VERSION:
        if runtime == 'game':
            install_home_summary()
        return VERSION
    assert QwenPawAgent._next_action is Agent._next_action
    assert not inspect.iscoroutinefunction(Agent._next_action)
    assert tuple(inspect.signature(Agent._next_action).parameters) == ('self', 'final_msg')
    verify_callable('next_action', Agent._next_action)
    QwenPawAgent._next_action = wrap_next_action(Agent._next_action)
    QwenPawAgent._qiandeng_llm_policy = VERSION
    if runtime == 'game':
        install_home_summary()
    return VERSION
