"""Bound local skill CLI requests to one actor; return actual correlated receipts."""
from pathlib import Path
import json
import os
import re
import time
import uuid


def request_skill(root, actor, command, timeout=20, request_id=None):
    if not re.fullmatch(r'(?:[A-Za-z0-9_]{1,16}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', actor or ''):
        raise ValueError('Actor must be a Minecraft login name or UUID')
    if not isinstance(command, str) or not command.strip() or len(command) > 1024 or any(c in command for c in '\r\n\0'):
        raise ValueError('Expected one command of at most 1024 characters')
    request_id = request_id or str(uuid.uuid4())
    if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', request_id):
        raise ValueError('request_id must be a lowercase UUID')
    mailbox = Path(root) / 'skill-cli'
    for name in ['requests', 'processing', 'results']:
        (mailbox / name).mkdir(parents=True, exist_ok=True)
    slot = mailbox / 'requests' / request_id
    claimed = mailbox / 'processing' / request_id
    result = mailbox / 'results' / (request_id + '.json')
    # Reusing an ID can read its outcome, but never silently change its actor/action.
    existing = next((p / 'request.json' for p in [claimed, slot] if (p / 'request.json').is_file()), None)
    if existing:
        previous = json.loads(existing.read_text(encoding='utf-8'))
        if previous.get('actor') != actor or previous.get('command') != command:
            raise ValueError('Request ID already belongs to a different actor or command')
    elif not result.is_file():
        slot.mkdir()  # exclusive reservation; no overwrite of a concurrent writer
        now = int(time.time() * 1000)
        payload = {'id': request_id, 'actor': actor, 'command': command, 'submittedAt': now, 'expiresAt': now + 30000}
        temp = slot / 'request.tmp'
        temp.write_text(json.dumps(payload, ensure_ascii=False) + '\n', encoding='utf-8')
        os.replace(temp, slot / 'request.json')
    deadline = time.monotonic() + max(0, min(float(timeout), 30))
    while True:
        if result.is_file():
            receipt = json.loads(result.read_text(encoding='utf-8'))
            if receipt.get('requestId') != request_id:
                raise ValueError('Receipt request ID mismatch')
            return receipt
        if time.monotonic() >= deadline:
            return {'ok': False, 'code': 'pending', 'requestId': request_id,
                    'summary': '请求已提交，结果仍待确认。请按 requestId 查回执，不要重新施法。'}
        time.sleep(0.1)


def read_receipt(root, request_id):
    if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', request_id):
        raise ValueError('request_id must be a lowercase UUID')
    path = Path(root) / 'skill-cli' / 'results' / (request_id + '.json')
    return json.loads(path.read_text(encoding='utf-8')) if path.is_file() else {
        'ok': False, 'code': 'pending', 'requestId': request_id, 'summary': '尚未收到执行回执。'}
