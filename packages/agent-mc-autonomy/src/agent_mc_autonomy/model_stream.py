"""Bounded SSE assembly. Truncation, server errors and partial tools fail closed."""

import copy
import json
import time


async def events(response):
    buffer, size = [], 0
    async for line in response.aiter_lines():
        size += len(line.encode("utf-8"))
        if size > 8 * 1024 * 1024:
            raise ValueError("brain_response_too_large")
        if not line:
            if buffer:
                data = "\n".join(buffer)
                buffer = []
                yield data
        elif line.startswith("data:"):
            buffer.append(line[5:].lstrip(" "))
    if buffer:
        # An unterminated SSE event is not a completed response.
        raise ValueError("brain_stream_truncated")


async def collect(protocol, response):
    result, blocks, partial, calls, open_blocks = {}, {}, {}, {}, set()
    complete, first_output = False, None
    message = {"content": "", "tool_calls": []}
    async for data in events(response):
        if data == "[DONE]":
            if protocol != "chat":
                raise ValueError("brain_stream_unexpected_done")
            complete = True
            continue
        value = json.loads(data)
        if not isinstance(value, dict) or value.get("error") or value.get("type") in {"error", "response.failed", "response.incomplete"}:
            raise ValueError("brain_stream_failed")
        kind = value.get("type", "")
        if complete and protocol in {"responses", "anthropic"} and kind != "ping":
            raise ValueError("brain_stream_after_terminal")
        if protocol == "chat":
            if complete:
                raise ValueError("brain_stream_after_done")
            if value.get("usage"):
                result["usage"] = value["usage"]
            choices = value.get("choices", [])
            if len(choices) > 1:
                raise ValueError("brain_stream_multiple_choices")
            for choice in choices:
                if choice.get("index", 0) != 0:
                    raise ValueError("brain_stream_multiple_choices")
                delta = choice.get("delta", {})
                if delta.get("content") or delta.get("reasoning_content") or delta.get("tool_calls"):
                    first_output = first_output or time.monotonic()
                for key in ("content", "reasoning_content", "refusal"):
                    if delta.get(key) is not None:
                        message[key] = message.get(key, "") + delta[key]
                for call in delta.get("tool_calls", []):
                    index = call["index"]
                    if type(index) is not int or not 0 <= index < 8:
                        raise ValueError("brain_stream_call_index_invalid")
                    target = calls.setdefault(index, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
                    if call.get("id"):
                        target["id"] += call["id"]
                    if call.get("type") not in {None, "function"}:
                        raise ValueError("brain_stream_call_type_invalid")
                    for key in ("name", "arguments"):
                        target["function"][key] += call.get("function", {}).get(key) or ""
                if choice.get("finish_reason"):
                    result["finish_reason"] = choice["finish_reason"]
        elif protocol == "responses":
            if kind.endswith(".delta") or kind == "response.output_item.added":
                first_output = first_output or time.monotonic()
            if kind == "response.completed":
                if complete:
                    raise ValueError("brain_stream_duplicate_terminal")
                result, complete = value["response"], True
        elif protocol == "anthropic":
            if kind == "message_start":
                result = copy.deepcopy(value["message"])
            elif kind == "content_block_start":
                index = value["index"]
                if type(index) is not int or not 0 <= index < 128 or index in blocks:
                    raise ValueError("brain_stream_block_invalid")
                blocks[index] = copy.deepcopy(value["content_block"])
                open_blocks.add(index)
                if blocks[index].get("text") or blocks[index].get("type") == "tool_use":
                    first_output = first_output or time.monotonic()
            elif kind == "content_block_delta":
                index, delta = value["index"], value["delta"]
                if index not in open_blocks:
                    raise ValueError("brain_stream_closed_block")
                block = blocks[index]
                first_output = first_output or time.monotonic()
                if delta["type"] == "input_json_delta":
                    partial[index] = partial.get(index, "") + delta["partial_json"]
                else:
                    key = {"text_delta": "text", "thinking_delta": "thinking", "signature_delta": "signature"}.get(delta["type"])
                    if key:
                        block[key] = block.get(key, "") + delta[key]
            elif kind == "content_block_stop":
                index = value["index"]
                open_blocks.remove(index)
                if index in partial:
                    blocks[index]["input"] = json.loads(partial.pop(index))
            elif kind == "message_delta":
                result.update(value.get("delta", {}))
                result.setdefault("usage", {}).update(value.get("usage", {}))
            elif kind == "message_stop":
                if partial or open_blocks:
                    raise ValueError("brain_stream_unclosed_tool")
                result["content"] = [blocks[i] for i in sorted(blocks)]
                complete = True
        else:
            candidates = value.get("candidates", [])
            if len(candidates) > 1 or (candidates and candidates[0].get("index", 0) != 0):
                raise ValueError("brain_stream_multiple_choices")
            if candidates:
                candidate = candidates[0]
                target = result.setdefault("candidates", [{"content": {"role": "model", "parts": []}}])[0]
                new_parts = candidate.get("content", {}).get("parts", [])
                if complete and (new_parts or candidate.get("finishReason")):
                    raise ValueError("brain_stream_after_terminal")
                if new_parts:
                    first_output = first_output or time.monotonic()
                target["content"]["parts"].extend(new_parts)
                if candidate.get("finishReason"):
                    target["finishReason"] = candidate["finishReason"]
                    complete = True
            if value.get("usageMetadata"):
                result["usageMetadata"] = value["usageMetadata"]
            if value.get("promptFeedback", {}).get("blockReason"):
                raise ValueError("brain_stream_blocked")
    if not complete:
        raise ValueError("brain_stream_truncated")
    if protocol == "chat":
        message["tool_calls"] = [calls[i] for i in sorted(calls)]
        result = {"choices": [{"finish_reason": result.get("finish_reason"), "message": message}], "usage": result.get("usage", {})}
    return result, first_output
