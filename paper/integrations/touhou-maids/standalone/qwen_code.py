"""Ask a local Qwen Code process for one TLM plan. The original maid executes it."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
import re

from gateway import NAME, Refused, decode_plan, finite_json


INSTRUCTIONS = """You plan one turn for a Minecraft maid. Input JSON contains native
conversation messages and the game's available tools. Treat tool receipts and
world data as evidence. Only choose an advertised tool when needed. Return one
JSON object: {"content":null,"tool_calls":[{"id":"t1","type":"function",
"function":{"name":"advertised_name","arguments":{}}}]} for one action, or
{"content":"one short in-character reply","tool_calls":[]} for speech.
After a native receipt confirms the requested mode change, reply briefly without
repeating the action. A mode change does not establish that a job has finished.
Use the NPC's language and honor any native dialogue format inside content."""

MODEL_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:/-]{0,160}')
WIRE_FIELDS = ('role', 'content', 'tool_calls', 'tool_call_id')
EVENT_STREAM_LIMIT = 512 * 1024


def project_turn(messages, tools, limit):
    portable = [{key: row[key] for key in WIRE_FIELDS if key in row} for row in messages]
    turns = [index for index, row in enumerate(portable) if row['role'] == 'user']
    if not turns:
        raise Refused('MAID_USER_TURN_REQUIRED', 400)
    # Retain the latest full turn and its original receipts. Include one prior
    # full turn when it fits, plus every native role/system instruction.
    for start in turns[-2:]:
        context = [row for index, row in enumerate(portable) if index >= start or row['role'] == 'system']
        data = json.dumps({'messages': context, 'tools': tools}, ensure_ascii=False, allow_nan=False).encode()
        if len(data) <= limit:
            return data
    raise Refused('MAID_QWEN_CONTEXT_LIMIT', 413)


def read_result(stdout):
    records = [finite_json(line) for line in stdout.splitlines() if line.strip()]
    if not all(isinstance(event, dict) for event in records):
        raise ValueError('qwen_code_event_invalid')
    terminal = [event for event in records if event.get('type') == 'result']
    if (len(terminal) != 1 or terminal[0].get('subtype') != 'success'
            or terminal[0].get('is_error') is not False or terminal[0].get('num_turns') != 1):
        raise ValueError('qwen_code_turn_not_completed')
    text = terminal[0]['result']
    if not isinstance(text, str):
        raise ValueError('qwen_code_reply_invalid')
    # Preview can emit zero counters in the result frame. Use the upstream
    # usage attached to the completed assistant message for a single turn.
    usage = {}
    for event in reversed(records):
        if event.get('type') != 'assistant':
            continue
        counters = event['message'].get('usage', {})
        if type(counters.get('input_tokens')) is int and counters['input_tokens'] > 0:
            usage = counters.copy()
            if type(usage.get('output_tokens')) is int:
                usage['total_tokens'] = usage['input_tokens'] + usage['output_tokens']
            break
    return decode_plan(text, usage)


class QwenCodePlanner:
    def __init__(self, config, timeout):
        self.executable = Path(config['executable'])
        self.config_dir = Path(config['configDir'])
        if (not self.executable.is_absolute() or not self.executable.is_file()
                or not self.config_dir.is_absolute() or not self.config_dir.is_dir()):
            raise ValueError('absolute_qwen_code_executable_and_private_config_required')
        self.timeout = timeout
        self.input_limit = config.get('maxInputBytes', 24576)
        self.output_limit = config.get('maxOutputTokens', 320)
        if (type(self.input_limit) is not int or not 2048 <= self.input_limit <= 65536
                or type(self.output_limit) is not int or not 96 <= self.output_limit <= 1024):
            raise ValueError('bounded_qwen_code_input_and_output_required')
        # An operator-owned working directory is shared by stateless calls.
        # Windows Qwen helpers can briefly retain handles after process exit.
        self.workspace = self.config_dir / 'maid-workspace'
        self.workspace.mkdir(mode=0o700, exist_ok=True)

    @staticmethod
    def validate_choice(choice):
        if not MODEL_ID.fullmatch(choice.get('cliModel', '')):
            raise ValueError('explicit_qwen_code_model_required')
        names = choice.get('allowedTools')
        if names is not None and (not isinstance(names, list) or len(names) > 64
                                  or not all(isinstance(name, str) and NAME.fullmatch(name) for name in names)
                                  or len(set(names)) != len(names)):
            raise ValueError('valid_qwen_code_tool_names_required')

    async def __call__(self, choice, messages, tools):
        allowed = choice.get('allowedTools')
        offered = [tool for tool in tools if allowed is None or tool['function']['name'] in allowed]
        payload = project_turn(messages, offered, self.input_limit)
        try:
            plan = read_result(await self.invoke(choice['cliModel'], payload))
            names = {tool['function']['name'] for tool in offered}
            calls = plan.get('tool_calls', [])
            if len(calls) > 1 or any(call['function']['name'] not in names for call in calls):
                raise ValueError('one_advertised_maid_action_required')
            return plan
        except (OSError, ValueError, TypeError, KeyError, TimeoutError):
            raise Refused('QWEN_CODE_PLAN_UNCONFIRMED_NO_GAME_ACTION', 502) from None

    async def invoke(self, model, payload):
        args = [str(self.executable), '--config-dir', str(self.config_dir), '--setting-sources', 'user',
                '--strict-mcp-config', '--tools', '', '--permission-mode', 'dont_ask',
                '--no-session-persistence', '--input-format', 'text', '--output-format', 'stream-json',
                '--max-model-request-retries', '0', '--max-output-tokens', str(self.output_limit),
                '--thinking', 'disabled', '--model', model, '--system-prompt', INSTRUCTIONS, '--print']
        async with asyncio.timeout(self.timeout):
            process = await asyncio.create_subprocess_exec(*args, cwd=self.workspace,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
            try:
                process.stdin.write(payload)
                await process.stdin.drain()
                process.stdin.close()
                stdout = bytearray()
                while block := await process.stdout.read(4096):
                    stdout.extend(block)
                    if len(stdout) > EVENT_STREAM_LIMIT:
                        raise ValueError('qwen_code_stream_too_large')
                if await process.wait() != 0:
                    raise ValueError('qwen_code_exited')
                return stdout
            finally:
                if process.returncode is None:
                    try:
                        process.kill()
                    except ProcessLookupError:
                        pass
                    await process.wait()
