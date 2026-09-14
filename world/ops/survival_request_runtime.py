"""Keep the dispatcher's current turn reference in native model input.

This is request data, not an authorization source. The gateway still validates
the exact submitted ID, lease expiry and action count. No tool argument is
filled, repaired or retried, and no conversation history is rewritten.
"""
from functools import wraps
import inspect
import json
import re

VERSION = 1
KEY = 'qiandeng_survival_turn'


def current_reference(agent):
    request = getattr(agent, '_request_context', None)
    if (not isinstance(request, dict)
            or str(getattr(agent, '_workspace_dir', '')) != '/state/work/workspaces/qd-survivor'
            or getattr(getattr(agent, '_agent_config', None), 'id', None) != 'qd-survivor'
            or request.get('agent_id') != 'qd-survivor'
            or request.get('user_id') != 'survival-controller'
            or request.get('channel') != 'console'):
        return None
    session = request.get('session_id')
    value = request.get(KEY)
    if (not isinstance(session, str) or not re.fullmatch(r'life-[0-9a-f]{32}', session)
            or not isinstance(value, dict) or value.get('version') != VERSION
            or value.get('session_id') != session
            or not isinstance(value.get('turn_id'), str)
            or not re.fullmatch(r'survival-[0-9a-f]{32}', value['turn_id'])):
        return None
    return {'turn_id': value['turn_id'], 'session_id': session}


def wrap_prepare(original):
    @wraps(original)
    async def prepare(self):
        result = await original(self)
        reference = current_reference(self)
        if reference is None:
            return result
        from agentscope.message import UserMsg
        # Input-only append after native compression, including its overflow
        # recovery path. Native context/summary/tool receipts remain untouched.
        note = UserMsg(name='survival-controller', content=(
            '当前调度请求的原始操作引用（对话压缩后仍保留）：' + json.dumps(reference, ensure_ascii=False)
            + '。需要 turn_id 时原样复制；这不是新任务、续租或授权。'
            '以工具实际回执为准；已过期或拒绝时结束本轮，不猜编号、不自动重试。'))
        return {**result, 'messages': [*result['messages'], note]}
    return prepare


def install(runtime):
    if runtime != 'game':
        raise ValueError('review_native_survival_request_contract')
    from qwenpaw_runtime_contract import verify_sources, verify_callable
    verify_sources('agent', 'builder')
    from qwenpaw.agents.react_agent import QwenPawAgent
    existing = getattr(QwenPawAgent, '_qiandeng_survival_request', None)
    if existing == VERSION:
        return VERSION
    if existing is not None:
        raise ValueError('survival_request_requires_fresh_process')
    original = QwenPawAgent._prepare_model_input
    if tuple(inspect.signature(original).parameters) != ('self',):
        raise ValueError('native_survival_request_signature_changed')
    verify_callable('prepare_model_input', original)
    QwenPawAgent._prepare_model_input = wrap_prepare(original)
    QwenPawAgent._qiandeng_survival_request = VERSION
    return VERSION
