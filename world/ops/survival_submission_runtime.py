"""Durable acknowledgement of the original native Qwen background submission.

No alternate task executor, retry, model call or inferred terminal outcome.
The native endpoint still owns admission, tracking and task execution.
"""
from functools import wraps
import hashlib
import inspect
import json
from pathlib import Path
import re
import time
from fastapi import Request

VERSION = 1
NATIVE_SHA = '10a699cbf6689ffff81f79223e6a62b7b8039b55a368057f9ff566a8996053a5'
CHAT_BUSY_DETAIL = ('A task is already running for this chat. Wait for it to '
                    'finish or use a different session_id.')


def identity(payload, role):
    if role != 'qd-survivor':
        return None
    context = payload.get('request_context')
    ref = context.get('qiandeng_survival_turn') if isinstance(context, dict) else None
    if ref is None:
        return None
    if (not isinstance(ref, dict) or ref.get('version') != 1
            or not re.fullmatch(r'survival-[0-9a-f]{32}', str(ref.get('turn_id', '')))
            or not re.fullmatch(r'life-[0-9a-f]{32}', str(ref.get('session_id', '')))
            or payload.get('session_id') != ref['session_id']
            or payload.get('user_id') != 'survival-controller' or payload.get('channel') != 'console'):
        raise ValueError('invalid_survival_submission_identity')
    return {'turnId': ref['turn_id'], 'sessionId': ref['session_id'], 'agentId': role,
            'userId': payload['user_id'], 'channel': 'console'}


async def submit_once(original, payload, request, workspace, *, root=None):
    from fastapi import HTTPException
    from agent_learning import read, write
    bound = identity(payload, workspace.agent_id)
    if bound is None:
        return await original(payload, request)
    folder = Path(root) if root is not None else Path(workspace.workspace_dir) / 'native-submissions'
    path = folder / (bound['turnId'] + '.json')
    # Synchronous read/write before the first await serializes this claim in
    # the native event loop. Never call the native POST twice for the same ID.
    if path.exists():
        raise HTTPException(status_code=409, detail='survival_submission_already_recorded')
    receipt = {'schema': VERSION, **bound, 'phase': 'unknown', 'createdAt': time.time(),
               'requestSha256': hashlib.sha256(json.dumps(payload, sort_keys=True, allow_nan=False).encode()).hexdigest()}
    write(path, receipt)
    try:
        result = await original(payload, request)
    except HTTPException as error:
        # This exact pinned native branch rejects before it creates a
        # background task. Other errors may occur after dispatch and remain
        # unknown. Keep the original single-submit receipt either way.
        if error.status_code == 409 and error.detail == CHAT_BUSY_DETAIL:
            write(path, {**receipt, 'phase': 'rejected', 'reason': 'chat_busy',
                         'rejectedAt': time.time()})
        raise
    task_id = result.get('task_id') if isinstance(result, dict) else None
    if not isinstance(task_id, str) or not re.fullmatch(r'task-[0-9a-f]{12}', task_id):
        raise ValueError('native_submission_receipt_invalid')
    write(path, {**receipt, 'phase': 'submitted', 'taskId': task_id, 'acknowledgedAt': time.time()})
    return result


def install():
    from qwenpaw_runtime_contract import release
    from qwenpaw.app.routers import console
    from fastapi import HTTPException
    from agent_learning import read
    release()
    if getattr(console, '_qd_survival_submission_version', None) == VERSION:
        return VERSION
    original = console.post_console_chat_task
    if hashlib.sha256(inspect.getsource(original).encode()).hexdigest() != NATIVE_SHA:
        raise ValueError('review_native_submission_endpoint')

    @wraps(original)
    async def wrapped(request_data: dict, request: Request):
        workspace = await console.get_agent_for_request(request)
        return await submit_once(original, request_data, request, workspace)

    matches = [r for r in console.router.routes if r.path == '/console/chat/task' and 'POST' in r.methods]
    if len(matches) != 1:
        raise ValueError('review_native_submission_route')
    matches[0].endpoint = wrapped
    matches[0].dependant.call = wrapped
    console.post_console_chat_task = wrapped

    @console.router.get('/survival-submission/{turn_id}')
    async def receipt(turn_id: str, request: Request):
        workspace = await console.get_agent_for_request(request)
        if workspace.agent_id != 'qd-survivor' or not re.fullmatch(r'survival-[0-9a-f]{32}', turn_id):
            raise HTTPException(status_code=404, detail='Survival submission not found')
        path = Path(workspace.workspace_dir) / 'native-submissions' / (turn_id + '.json')
        if not path.exists():
            raise HTTPException(status_code=404, detail='Survival submission not found')
        return read(path)

    console._qd_survival_submission_version = VERSION
    return VERSION
