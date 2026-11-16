"""Serve separately authorized TLM maids through HarnessRouter or Qwen Code."""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
import re
import threading
import uuid

from gateway import (Gateway, QWEN_CODE, Refused, decode_plan, finite_json,
                     native_plan_payload, server_for, validate_config)

PROTOCOL = '2026-09-28'
RESPONSE_ID = re.compile(r'resp_[A-Za-z0-9_-]{1,128}')
INSTRUCTIONS = (
    'You plan one turn for an existing Minecraft maid. Treat the supplied messages as the conversation and '
    'the supplied tools as the only in-game actions available to propose. Return one JSON object with '
    '"content" (text or null) and "tool_calls" (an array). Each tool call has a unique id, type "function", '
    'and function with name and JSON arguments. Use a short natural reply with an empty tool_calls array '
    'when no action is needed. Do not run tools yourself, use shell commands, access files or retry a '
    'previous turn. Use the native tool receipts to confirm what happened.'
)


class DshPlanner:
    def __init__(self, config):
        import httpx
        self.httpx = httpx
        self.base = config['hub']['base_url'].rstrip('/')
        key = finite_json(Path(config['hub']['keyFile']).read_text(encoding='utf-8-sig'))['key']
        if not isinstance(key, str) or not 20 <= len(key) <= 4096 or any(ord(char) < 33 for char in key):
            raise ValueError('private_hub_key_required')
        self.timeout = config['timeoutSeconds']
        self.headers = {'Authorization': 'Bearer ' + key, 'UHP-Version': PROTOCOL}

    async def request(self, client, method, route, **kwargs):
        async with client.stream(method, self.base + route, **kwargs) as response:
            response.raise_for_status()
            raw = bytearray()
            async for chunk in response.aiter_bytes():
                raw.extend(chunk)
                if len(raw) > 2 * 1024 * 1024:
                    raise ValueError('harness_response_too_large')
            return finite_json(raw)

    async def __call__(self, choice, messages, tools):
        fields = {'role', 'content', 'tool_calls', 'tool_call_id'}
        portable = [{key: value for key, value in row.items() if key in fields} for row in messages]
        body = {'input': json.dumps({'messages': portable, 'tools': tools}, ensure_ascii=False, allow_nan=False),
                'instructions': INSTRUCTIONS, 'metadata': {'harness_id': choice['harness_id']},
                'model': choice['model'], 'stream': False, 'background': True, 'max_step': 3,
                'max_output_tokens': 1024, 'timeout_seconds': self.timeout}
        original = None
        async with self.httpx.AsyncClient(timeout=self.timeout, trust_env=False, follow_redirects=False) as client:
            try:
                async with asyncio.timeout(self.timeout):
                    headers = {**self.headers, 'Idempotency-Key': str(uuid.uuid4())}
                    response = await self.request(client, 'POST', '/v1/responses', headers=headers, json=body)
                    response_id = response.get('id')
                    if not isinstance(response_id, str) or not RESPONSE_ID.fullmatch(response_id):
                        raise ValueError('harness_response_id_invalid')
                    original = '/v1/responses/' + response_id
                    while response.get('status') in {'queued', 'in_progress', 'running'}:
                        await asyncio.sleep(.5)
                        response = await self.request(client, 'GET', original, headers=self.headers)
                        if response.get('id') != response_id:
                            raise ValueError('harness_response_identity_mismatch')
                    if response.get('status') != 'completed' or response.get('model', choice['model']) != choice['model']:
                        raise ValueError('expected_completed_response_from_selected_model')
                    return self.decode(response)
            except Exception:
                if original is not None:
                    try:
                        async with asyncio.timeout(3):
                            await self.request(client, 'POST', original + '/cancel', headers=self.headers)
                    except Exception:
                        pass
                raise Refused('HARNESS_RESULT_UNKNOWN_NO_REPLAY', 502) from None

    @staticmethod
    def decode(response):
        response = native_plan_payload(response)
        text = ''.join(part['text'] for item in response.get('output', [])
                       if item.get('type') == 'message' and item.get('role', 'assistant') == 'assistant'
                       for part in item.get('content', []) if part.get('type') == 'output_text')
        return decode_plan(text, response.get('usage') or {})


def bindings(config):
    maids = config.get('maids')
    limit = config.get('maxConcurrent', 4)
    if not isinstance(maids, list) or not 1 <= len(maids) <= 64 or type(limit) is not int or not 1 <= limit <= 16:
        raise ValueError('one_to_64_maids_and_bounded_concurrency_required')
    common = {key: config[key] for key in ('schema', 'host', 'port')}
    common.update({key: config[key] for key in ('hub', 'qwenCode') if key in config})
    common['timeoutSeconds'] = config.get('timeoutSeconds', 40)
    rows = [validate_config({**common, **{key: maid[key] for key in ('maidId', 'ownerId', 'token', 'choices')}})
            for maid in maids]
    if len({row['maidId'] for row in rows}) != len(rows) or len({row['token'] for row in rows}) != len(rows):
        raise ValueError('each_maid_requires_an_independent_transport_token')
    return common, rows, limit


def create_server(config):
    common, rows, limit = bindings(config)
    choices = [choice for row in rows for choice in row['choices'].values()]
    dsh = DshPlanner(common) if any(choice['harness_id'] != QWEN_CODE for choice in choices) else None
    qwen = None
    if any(choice['harness_id'] == QWEN_CODE for choice in choices):
        from qwen_code import QwenCodePlanner
        qwen = QwenCodePlanner(common['qwenCode'], common['timeoutSeconds'])
        for choice in choices:
            if choice['harness_id'] == QWEN_CODE:
                qwen.validate_choice(choice)
    capacity = threading.BoundedSemaphore(limit)

    async def limited_planner(choice, messages, tools):
        if not capacity.acquire(blocking=False):
            raise Refused('MAID_HUB_BUSY_TRY_A_LATER_NEW_TURN', 429)
        try:
            planner = qwen if choice['harness_id'] == QWEN_CODE else dsh
            return await planner(choice, messages, tools)
        finally:
            capacity.release()

    return server_for(common, gateways={row['maidId']: Gateway(row, limited_planner) for row in rows})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', type=Path)
    args = parser.parse_args()
    config = finite_json(args.config.read_text(encoding='utf-8-sig'))
    with create_server(config) as server:
        print(f'TLM maid transport listening on 127.0.0.1:{server.server_port}', flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()
