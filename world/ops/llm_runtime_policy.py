"""Project-owned Qwen 2.2 policy: no artificial QPM or iteration quota.

Qwen's disabled iteration gate does not disable AgentScope's separate cap.
The process-local adapter honors that native switch for Qwen agents only; it
uses mathematical infinity during the synchronous next-action decision and
restores the serializable native config before any model/tool work starts.
"""
from copy import deepcopy
from functools import wraps
import importlib.metadata
import inspect
import math

VERSION = 1
QWEN_VERSION = '2.2.0'
AGENTSCOPE_VERSION = '2.0.7.post1'


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


def install(runtime):
    if runtime not in ('game', 'operations'):
        raise ValueError('invalid_llm_policy_runtime')
    if (importlib.metadata.version('qwenpaw') != QWEN_VERSION
            or importlib.metadata.version('agentscope') != AGENTSCOPE_VERSION):
        raise ValueError('review_new_qwen_iteration_contract')
    from qwenpaw.agents.react_agent import QwenPawAgent
    from agentscope.agent import Agent
    if getattr(QwenPawAgent, '_qiandeng_llm_policy', None) == VERSION:
        return VERSION
    assert QwenPawAgent._next_action is Agent._next_action
    assert not inspect.iscoroutinefunction(Agent._next_action)
    assert tuple(inspect.signature(Agent._next_action).parameters) == ('self', 'final_msg')
    QwenPawAgent._next_action = wrap_next_action(Agent._next_action)
    QwenPawAgent._qiandeng_llm_policy = VERSION
    return VERSION
