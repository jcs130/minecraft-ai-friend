"""Conservative detection of runaway plain replies, not a personality policy."""

import re

from .narration import spoken_line


def repeated_plain_reply(response):
    """Flag only long, dominant runs with no structured tool call.

    Brief repetition, ordinary conversation, pauses and tool-bearing responses
    stay with their existing contracts. This does not infer a game intention.
    """
    content = response.get("content")
    if response.get("tool_calls") or not isinstance(content, str) or not 1 <= len(content) <= 65536:
        return None
    content = spoken_line(content) or content
    total = len(re.sub(r"\s+", "", content))
    previous, count, longest, repeated_chars = None, 0, 0, 0
    for clause in re.split(r"[。！？!?；;\n]+", content):
        clause = re.sub(r"\s+", "", clause)
        count = count + 1 if clause and clause == previous else 1
        previous = clause
        size = len(clause) * count
        if len(clause) >= 6 and count >= 8 and size > repeated_chars:
            longest, repeated_chars = count, size
    if longest < 8 or repeated_chars < total * 0.75:
        return None
    return {"code": "repetitive_model_reply", "repetitions": longest,
            "repeated_characters": repeated_chars, "content_characters": total, "dispatched": False}
