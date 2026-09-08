"""One durable Qwen conversation identity; execution IDs remain per attempt."""
from pathlib import Path
import re
import uuid

from numen_gateway import action_lock, read_json, write_json


def load_session(state, settings):
    path = Path(state) / 'life-session.json'
    binding = {'agentId': 'qd-survivor', 'bodyUuid': settings['bodyUuid'],
               'userId': 'survival-controller', 'channel': 'console'}
    with action_lock(state, blocking=True):
        if path.exists():
            value = read_json(path)
            if (value.get('schema') != 1 or any(value.get(k) != v for k, v in binding.items())
                    or not isinstance(value.get('primarySessionId'), str)
                    or not value['primarySessionId'].startswith('life-')
                    or len(value['primarySessionId']) != 37):
                raise ValueError('life_session_binding_invalid')
            uuid.UUID(value['primarySessionId'][5:])
            return value
        value = {'schema': 1, **binding, 'primarySessionId': 'life-' + uuid.uuid4().hex,
                 'chatId': None}
        write_json(path, value)
        return value


def bind_chat(state, session, chat_id):
    if not isinstance(chat_id, str) or str(uuid.UUID(chat_id)) != chat_id:
        raise ValueError('native_chat_id_invalid')
    if session.get('chatId') not in (None, chat_id):
        raise ValueError('life_session_chat_changed')
    session['chatId'] = chat_id
    write_json(Path(state) / 'life-session.json', session)


def final_text(native):
    """Last completed assistant message, excluding native framework termination text."""
    if not isinstance(native, dict) or native.get('status') != 'completed':
        return ''
    answer = ''
    for item in native.get('output', []) if isinstance(native.get('output'), list) else []:
        if (not isinstance(item, dict) or item.get('role') != 'assistant'
                or item.get('type') != 'message' or item.get('status') != 'completed'):
            continue
        texts = []
        for content in item.get('content', []) if isinstance(item.get('content'), list) else []:
            if isinstance(content, dict) and content.get('type') == 'text':
                text = content.get('text')
                if isinstance(text, str):
                    texts.append(text)
        text = '\n'.join(texts).strip()
        # Do not fall back to earlier step narration if the terminal message is
        # empty or a framework sentinel. Qwen 2.2 IterationGate emits the latter
        # with ordinary completed/message metadata, even after successful tools.
        answer = text
    if re.fullmatch(r'Max iterations \([0-9]+\) reached', answer):
        return ''
    # A partial/truncated answer is not silently substituted as a complete reply.
    return answer if len(answer) <= 6000 else ''
