"""Honor a model's explicit finish request via the existing native reply exit.

No timer, repetition counter, game action, model call or fabricated completion.
Ordinary remember calls remain checkpoints. Only the current successful MCP
call with finish_turn=true supplies the model-authored final answer.
"""
from functools import wraps
import inspect
import json
import re

VERSION = 3
TOOL = 'numen_survival__remember'
CONTRACT = 'qiandeng-survival-turn-v1'


def completion_summary(agent):
    # AgentState.session_id is an independent native identifier persisted in
    # the session file. AgentBuilder puts the actual external conversation and
    # caller identity in _request_context; never rename the native state ID.
    request = getattr(agent, '_request_context', None)
    if (str(getattr(agent, '_workspace_dir', '')) != '/state/work/workspaces/qd-survivor'
            or getattr(getattr(agent, '_agent_config', None), 'id', None) != 'qd-survivor'
            or not isinstance(request, dict)
            or request.get('agent_id') != 'qd-survivor'
            or request.get('user_id') != 'survival-controller'
            or request.get('channel') != 'console'
            or not isinstance(request.get('session_id'), str)
            or re.fullmatch(r'life-[0-9a-f]{32}', request['session_id']) is None):
        return None
    message = agent._get_last_msg()
    if message is None or message.id != agent.state.reply_id:
        return None
    calls = message.get_content_blocks('tool_call')
    results = message.get_content_blocks('tool_result')
    # Only the final selected tool may close a round; never drop later calls.
    if not calls or calls[-1].name != TOOL:
        return None
    call = calls[-1]
    if getattr(agent, '_qiandeng_survival_finish_emitted', None) == (message.id, call.id):
        return None
    args = call.input
    if isinstance(args, str) and len(args) <= 16000:
        try:
            args = json.loads(args)
        except ValueError:
            return None
    if not isinstance(args, dict) or args.get('finish_turn') is not True:
        return None
    summary = args.get('summary')
    if not isinstance(summary, str) or not 1 <= len(summary.strip()) <= 600:
        return None
    matching = [row for row in results if row.id == call.id and row.name == TOOL]
    if len(matching) != 1 or matching[0].state != 'success':
        return None
    result = matching[0].output
    # AgentScope normalizes actual MCP/function results to a text-block list.
    # Accept one unambiguous text payload, never concatenate mixed evidence.
    if isinstance(result, list):
        if len(result) != 1:
            return None
        block = result[0]
        if isinstance(block, dict):
            result = block.get('text') if block.get('type') == 'text' else None
        else:
            result = getattr(block, 'text', None) if getattr(block, 'type', None) == 'text' else None
    try:
        # Native MCP outputs may contain JSON string encoding around JSON.
        for _ in range(2):
            if isinstance(result, str) and len(result) <= 16000:
                result = json.loads(result)
        if not isinstance(result, dict):
            return None
        intent = result.get('turnCompletion', {})
        if (result.get('ok') is not True or result.get('code') != 'memory_recorded'
                or result.get('memorySaved') is not True or not isinstance(intent, dict)
                or intent.get('requested') is not True or intent.get('contract') != CONTRACT
                or intent.get('summary') != summary.strip()):
            return None
    except (ValueError, TypeError):
        return None
    return summary.strip()


def wrap_reasoning_impl(original):
    """Use the native text path; Exit alone neither saves nor streams text.

    This inner hook retains QwenPaw's outer pending gates, stop handlers and
    AgentScope reasoning middleware. It does not manufacture model-call events
    or usage. The text already came from the current model's successful tool.
    """
    @wraps(original)
    async def reasoning_impl(self, tool_choice=None):
        from agentscope.agent._utils import Reasoning
        from agentscope.event import TextBlockEndEvent, ReplyFinishedReason
        from agentscope.message import AssistantMsg, TextBlock
        from agentscope.model import ChatResponse

        # The outer native loop has selected Reasoning. Recheck after native
        # middleware/context preparation: pending tools and schema remain first.
        running = getattr(getattr(self, '_agent_config', None), 'running', None)
        iteration = getattr(getattr(running, 'loop', None), 'iteration', None)
        unlimited = getattr(iteration, 'enabled', None) is False
        eligible = (isinstance(self._next_action(None), Reasoning)
                    and self.state.reply_context.structured_schema is None
                    and (unlimited or self.state.cur_iter < self.react_config.max_iters))
        summary = completion_summary(self) if eligible else None
        if summary is None:
            async for event in original(self, tool_choice=tool_choice):
                yield event
            return
        message = self._get_last_msg()
        call = message.get_content_blocks('tool_call')[-1]
        blocks = [TextBlock(text=summary)]
        block_ids = {'text': None, 'thinking': None, 'tools': [], 'data': []}
        response = ChatResponse(content=blocks, is_last=True)
        async for event in self._convert_chat_response_to_event(block_ids, response):
            yield event
        yield TextBlockEndEvent(reply_id=self.state.reply_id, block_id=block_ids['text'])
        self._save_to_context(blocks)
        self._qiandeng_survival_finish_emitted = (message.id, call.id)
        yield AssistantMsg(id=self.state.reply_id, name=self.name, content=blocks,
                           finished_reason=ReplyFinishedReason.COMPLETED)
    return reasoning_impl


def install(runtime):
    if runtime != 'game':
        raise ValueError('survival_finish_requires_game_runtime')
    from qwenpaw_runtime_contract import verify_sources, verify_callable
    verify_sources('agent', 'builder')
    from qwenpaw.agents.react_agent import QwenPawAgent
    if getattr(QwenPawAgent, '_qiandeng_survival_finish', None) == VERSION:
        return VERSION
    if getattr(QwenPawAgent, '_qiandeng_survival_finish', None) is not None:
        raise ValueError('survival_finish_requires_fresh_process')
    original = QwenPawAgent._reasoning_impl
    if tuple(inspect.signature(original).parameters) != ('self', 'tool_choice'):
        raise ValueError('native_survival_finish_signature_changed')
    verify_callable('reasoning_impl', original)
    QwenPawAgent._reasoning_impl = wrap_reasoning_impl(original)
    QwenPawAgent._qiandeng_survival_finish = VERSION
    return VERSION
