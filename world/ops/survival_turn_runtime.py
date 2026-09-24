"""Close finished or revoked planning rounds through the native reply exit.

No timer, repetition counter, game action, model call or fabricated completion.
Ordinary remember calls remain checkpoints. The current successful remember
or program queue receipt may carry the model-authored final answer. Queue
acceptance ends deliberation; it does not assert program execution or success.
A verified closed/expired authority rejection ends only that current round.
"""
from functools import wraps
import inspect
import json
import re

VERSION = 6
TOOL = 'numen_survival__remember'
START_TOOL = 'numen_survival__skill_start'
NAVIGATE_TOOL = 'numen_survival__navigate'
NAVIGATE_PLAN_TOOL = 'numen_survival__navigate_plan'
CONTRACT = 'qiandeng-survival-turn-v1'
ENDED_CONTRACT = 'qiandeng-survival-authority-ended-v1'
ENDED_SUMMARY = '本轮操作权限已结束，等待下一轮重新观察。游戏动作结果仍以原回执为准。'


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
    if not calls or not calls[-1].name.startswith('numen_survival__'):
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
    if not isinstance(args, dict):
        return None
    matching = [row for row in results if row.id == call.id and row.name == call.name]
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
        ended = result.get('turnEnded')
        if isinstance(ended, dict) and ended.get('contract') == ENDED_CONTRACT:
            turn = args.get('turn_id')
            if (isinstance(turn, str) and re.fullmatch(r'[A-Za-z0-9_-]{16,128}', turn)
                    and result.get('turnId') == turn and result.get('ok') is False
                    and result.get('code') in ('cognition_closed', 'cognition_expired')
                    and result.get('dispatched') is False and result.get('writePerformed') is False
                    and ended.get('authorityEnded') is True
                    and ended.get('gameOutcomeConfirmed') is False):
                return ENDED_SUMMARY
            return None
        if call.name not in (TOOL, START_TOOL, NAVIGATE_TOOL, NAVIGATE_PLAN_TOOL):
            return None
        if call.name == TOOL and args.get('finish_turn') is not True:
            return None
        summary = args.get('summary')
        if not isinstance(summary, str) or not 1 <= len(summary.strip()) <= 600:
            return None
        intent = result.get('turnCompletion', {})
        if (result.get('ok') is not True or not isinstance(intent, dict)
                or intent.get('requested') is not True or intent.get('contract') != CONTRACT
                or intent.get('summary') != summary.strip()):
            return None
        if call.name == TOOL:
            if result.get('code') != 'memory_recorded' or result.get('memorySaved') is not True:
                return None
        elif call.name == START_TOOL and result.get('code') == 'skill_queued':
            if result.get('code') != 'skill_queued' or result.get('executionConfirmed') is not False:
                return None
            for arg_key, receipt_key in (('name', 'name'), ('version', 'version'), ('turn_id', 'turnId')):
                value = args.get(arg_key)
                if not isinstance(value, str) or not value.strip() or result.get(receipt_key) != value:
                    return None
        else:
            turn, version = args.get('turn_id'), result.get('version')
            if (not isinstance(turn, str) or re.fullmatch(r'[A-Za-z0-9_-]{16,128}', turn) is None
                    or result.get('turnId') != turn or result.get('executionConfirmed') is not False
                    or not isinstance(version, str) or re.fullmatch(r'[0-9a-f]{64}', version) is None):
                return None
            if call.name in (NAVIGATE_TOOL, NAVIGATE_PLAN_TOOL):
                if result.get('name') != ('base_navigate' if call.name == NAVIGATE_TOOL else 'base_motion_plan'):
                    return None
            elif (not isinstance(args.get('name'), str) or not args['name'].strip()
                    or result.get('name') != args['name'] or version != args.get('version')):
                return None
            if result.get('code') == 'motor_queued':
                request_id = result.get('requestId')
                if (result.get('kind') != 'skill' or result.get('status') != 'queued'
                        or not isinstance(request_id, str)
                        or re.fullmatch(r'[0-9a-f]{64}', request_id) is None):
                    return None
            elif call.name not in (NAVIGATE_TOOL, NAVIGATE_PLAN_TOOL) or result.get('code') != 'skill_queued':
                return None
    except (ValueError, TypeError):
        return None
    return summary.strip()


def wrap_reasoning_impl(original):
    """Use the native text path; Exit alone neither saves nor streams text.

    This inner hook retains QwenPaw's outer pending gates, stop handlers and
    AgentScope reasoning middleware. It does not manufacture model-call events
    or usage. The text is the model's successful finish summary, or a factual
    authority-ended notice from the exact current rejected call. Neither path
    fabricates game success or touches another native task/session.
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
