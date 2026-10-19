"""Wire codecs only; no model may dispatch a game action from a partial response."""

import copy
import hashlib
import json
import uuid
from urllib.parse import quote


def scope(config):
    return hashlib.sha256(json.dumps([config.provider, config.protocol, config.base_url.rstrip("/"), config.model,
                                     config.auth.mode, config.auth.credential_id, config.api_key_env]).encode()).hexdigest()


def assistant_history(response):
    result = {"role": "assistant", "content": response.get("content")}
    if response.get("tool_calls"):
        result["tool_calls"] = response["tool_calls"]
    if response.get("_provider_state"):
        result["_provider_state"] = response["_provider_state"]
    if isinstance(response.get("reasoning_content"), str):
        result["reasoning_content"] = response["reasoning_content"]
    return copy.deepcopy(result)


def native(message, config):
    state = message.get("_provider_state", {})
    return copy.deepcopy(state.get("data")) if state.get("scope") == scope(config) else None


def parts(content):
    if isinstance(content, str):
        return [{"type": "text", "text": content}] if content else []
    return content or []


def image_data(part):
    url = part["image_url"]["url"]
    if not isinstance(url, str) or not url.startswith("data:image/") or ";base64," not in url:
        raise ValueError("brain_native_image_requires_inline_data")
    header, data = url.split(",", 1)
    mime = header[5:].removesuffix(";base64")
    if mime not in {"image/png", "image/jpeg", "image/webp", "image/gif"} or not data:
        raise ValueError("brain_image_format_invalid")
    return mime, data


def request(config, messages, tools, budget):
    config.validate_reasoning_history()
    config.validate_cache_strategy()
    p = config.protocol
    options = copy.deepcopy(config.parameters)
    if not tools:
        options.pop("tool_choice", None)
    base = config.base_url.rstrip("/")
    if p == "chat":
        rows = []
        last_user = max((index for index, message in enumerate(messages) if message.get("role") == "user"), default=-1)
        for index, message in enumerate(messages):
            row = {k: copy.deepcopy(v) for k, v in message.items() if k in {"role", "content", "tool_calls", "tool_call_id", "name"}}
            state = native(message, config)
            if (state and "reasoning_content" in state
                    and (config.reasoning_history == "all" or index > last_user)):
                row["reasoning_content"] = state["reasoning_content"]
            rows.append(row)
        if config.cache_strategy == "ninfer":
            # Keep a stable anchor AND overlapping recent history boundaries.
            # A moving last-only marker is never demanded twice when the cache
            # is full; repeatedly saving the replaced scene also wastes room.
            candidates = []
            for row in rows[:last_user if last_user >= 0 else len(rows)]:
                content = row.get("content")
                if isinstance(content, str):
                    content = [{"type": "text", "text": content}] if content else []
                if not isinstance(content, list):
                    continue
                part = next((part for part in reversed(content) if part.get("type") == "text" and part.get("text")), None)
                if part is not None:
                    candidates.append((row, content, part))
            selected = candidates[:1] + candidates[max(1, len(candidates) - 3):]
            for row, content, part in selected:
                part["prompt_cache_breakpoint"] = {"mode": "explicit"}
                row["content"] = content
            options["prompt_cache_options"] = {"mode": "explicit"}
            # An explicitly supplied key remains supported for append-only
            # clients. Do not auto-create prompt-end private anchors for the
            # controller's replaced current-facts tail.
        body = {**options, "model": config.model, "messages": rows, "stream": config.stream, config.output_parameter: budget, "parallel_tool_calls": False}
        if tools:
            body.update(tools=tools, parallel_tool_calls=False)
        if config.stream:
            body["stream_options"] = {"include_usage": True}
        return base + "/chat/completions", body
    if p == "responses":
        rows = []
        for message in messages:
            state = native(message, config)
            if message["role"] == "assistant" and state is not None:
                rows.extend(state)
            elif message["role"] == "tool":
                rows.append({"type": "function_call_output", "call_id": message["tool_call_id"], "output": message["content"]})
            else:
                content = []
                for part in parts(message.get("content")):
                    if part["type"] == "text":
                        content.append({"type": "output_text" if message["role"] == "assistant" else "input_text", "text": part["text"]})
                    elif part["type"] == "image_url":
                        content.append({"type": "input_image", **part["image_url"]})
                        content[-1]["image_url"] = content[-1].pop("url")
                if content:
                    rows.append({"role": message["role"], "content": content})
                for call in message.get("tool_calls", []):
                    rows.append({"type": "function_call", "call_id": call["id"], **call["function"]})
        body = {**options, "model": config.model, "input": rows, "max_output_tokens": budget,
                "stream": config.stream, "store": False, "include": ["reasoning.encrypted_content"]}
        if tools:
            body.update(tools=[{"type": "function", **tool["function"], "strict": False} for tool in tools], parallel_tool_calls=False)
        return base + "/responses", body
    if p == "anthropic":
        rows, system = [], []
        for message in messages:
            role = message["role"]
            if role in {"system", "developer"}:
                system.extend(parts(message.get("content")))
                continue
            content = native(message, config) if role == "assistant" else None
            if role == "tool":
                role, content = "user", [{"type": "tool_result", "tool_use_id": message["tool_call_id"], "content": message["content"]}]
            if content is None:
                content = []
                for part in parts(message.get("content")):
                    if part["type"] == "text":
                        content.append(copy.deepcopy(part))
                    elif part["type"] == "image_url":
                        mime, data = image_data(part)
                        content.append({"type": "image", "source": {"type": "base64", "media_type": mime, "data": data}})
                for call in message.get("tool_calls", []):
                    content.append({"type": "tool_use", "id": call["id"], "name": call["function"]["name"], "input": json.loads(call["function"]["arguments"])})
            if content:
                if rows and rows[-1]["role"] == role:
                    rows[-1]["content"].extend(content)
                else:
                    rows.append({"role": role, "content": content})
        body = {**options, "model": config.model, "system": system, "messages": rows, "stream": config.stream, "max_tokens": budget}
        if options.get("thinking", {}).get("budget_tokens", 0) >= budget:
            raise ValueError("brain_thinking_budget_must_be_less_than_output")
        if tools:
            body["tools"] = [{"name": tool["function"]["name"], "description": tool["function"].get("description", ""),
                              "input_schema": tool["function"]["parameters"]} for tool in tools]
            body["tool_choice"] = {"type": "auto", "disable_parallel_tool_use": True}
        return base + "/messages", body
    rows, system, call_names, native_ids = [], [], {}, {}
    for message in messages:
        role = message["role"]
        if role in {"system", "developer"}:
            system.extend({"text": part["text"]} for part in parts(message.get("content")) if part["type"] == "text")
            continue
        content = native(message, config) if role == "assistant" else None
        calls = message.get("tool_calls", [])
        for call in calls:
            call_names[call["id"]] = call["function"]["name"]
        if content is not None:
            wire_calls = [part["functionCall"] for part in content if "functionCall" in part]
            for call, wire in zip(calls, wire_calls):
                if wire.get("id"):
                    native_ids[call["id"]] = wire["id"]
        if role == "tool":
            call_id = message["tool_call_id"]
            result = {"name": call_names[call_id], "response": {"result": message["content"]}}
            if call_id in native_ids:
                result["id"] = native_ids[call_id]
            content = [{"functionResponse": result}]
        elif content is None:
            content = []
            for part in parts(message.get("content")):
                if part["type"] == "text":
                    content.append({"text": part["text"]})
                elif part["type"] == "image_url":
                    mime, data = image_data(part)
                    content.append({"inlineData": {"mimeType": mime, "data": data}})
            content.extend({"functionCall": {"name": call["function"]["name"], "args": json.loads(call["function"]["arguments"])}} for call in calls)
        role = "model" if role == "assistant" else "user"
        if content:
            if rows and rows[-1]["role"] == role:
                rows[-1]["parts"].extend(content)
            else:
                rows.append({"role": role, "parts": content})
    body = {"contents": rows, "systemInstruction": {"parts": system}, "generationConfig": {**options, "maxOutputTokens": budget, "candidateCount": 1}}
    if tools:
        body["tools"] = [{"functionDeclarations": [{"name": t["function"]["name"], "description": t["function"].get("description", ""),
                                                  "parametersJsonSchema": t["function"]["parameters"]} for t in tools]}]
    method = ":streamGenerateContent?alt=sse" if config.stream else ":generateContent"
    return base + "/models/" + quote(config.model.removeprefix("models/"), safe="") + method, body


def tool_call(identifier, name, arguments):
    if not isinstance(arguments, dict):
        raise ValueError("brain_tool_input_invalid")
    return {"id": identifier or "call_" + uuid.uuid4().hex, "type": "function",
            "function": {"name": name, "arguments": json.dumps(arguments, ensure_ascii=False, allow_nan=False)}}


def decode(config, payload):
    p, calls, texts, usage = config.protocol, [], [], payload.get("usage") or {}
    if p == "chat":
        choices = payload["choices"]
        if len(choices) != 1 or choices[0].get("finish_reason") not in {"stop", "tool_calls"}:
            raise ValueError("brain_response_incomplete")
        message = choices[0]["message"]
        if message.get("refusal"):
            raise ValueError("brain_response_refused")
        state = {"reasoning_content": message["reasoning_content"]} if isinstance(message.get("reasoning_content"), str) else {}
        return message, state, usage
    if p == "responses":
        if payload.get("status") != "completed" or payload.get("error"):
            raise ValueError("brain_response_incomplete")
        state = payload["output"]
        for item in state:
            if item["type"] == "function_call":
                calls.append({"id": item["call_id"], "type": "function", "function": {"name": item["name"], "arguments": item["arguments"]}})
            elif item["type"] == "message":
                for part in item["content"]:
                    if part["type"] != "output_text":
                        raise ValueError("brain_response_refused")
                    texts.append(part["text"])
            elif item["type"] != "reasoning":
                raise ValueError("brain_unrequested_server_tool")
    elif p == "anthropic":
        if payload.get("stop_reason") not in {"end_turn", "tool_use", "stop_sequence"}:
            raise ValueError("brain_response_incomplete")
        state = payload["content"]
        for part in state:
            if part["type"] == "text":
                texts.append(part["text"])
            elif part["type"] == "tool_use":
                calls.append(tool_call(part["id"], part["name"], part["input"]))
            elif part["type"] not in {"thinking", "redacted_thinking"}:
                raise ValueError("brain_unrequested_server_tool")
    else:
        candidate = payload["candidates"][0]
        if len(payload["candidates"]) != 1 or candidate.get("finishReason") != "STOP":
            raise ValueError("brain_response_incomplete")
        state, usage = candidate["content"]["parts"], payload.get("usageMetadata") or {}
        for part in state:
            if "text" in part and not part.get("thought"):
                texts.append(part["text"])
            if "functionCall" in part:
                call = part["functionCall"]
                calls.append(tool_call(call.get("id"), call["name"], call.get("args", {})))
    return {"content": "".join(texts) or None, "tool_calls": calls}, copy.deepcopy(state), usage


def usage_metrics(protocol, usage):
    keys = {"prompt_tokens": "prompt_tokens", "completion_tokens": "completion_tokens", "total_tokens": "total_tokens",
            "prompt_cache_hit_tokens": "cached_tokens", "prompt_cache_miss_tokens": "cache_miss_tokens"}
    if protocol in {"responses", "anthropic"}:
        keys = {"input_tokens": "prompt_tokens", "output_tokens": "completion_tokens", "total_tokens": "total_tokens",
                "cache_read_input_tokens": "cached_tokens", "cache_creation_input_tokens": "cache_write_tokens"}
    elif protocol == "gemini":
        keys = {"promptTokenCount": "prompt_tokens", "candidatesTokenCount": "completion_tokens", "totalTokenCount": "total_tokens",
                "cachedContentTokenCount": "cached_tokens", "thoughtsTokenCount": "reasoning_tokens"}
    result = {target: usage[source] for source, target in keys.items() if type(usage.get(source)) is int and usage[source] >= 0}
    for source, target in (("prompt_tokens_details", "cached_tokens"), ("input_tokens_details", "cached_tokens"),
                           ("completion_tokens_details", "reasoning_tokens"), ("output_tokens_details", "reasoning_tokens")):
        value = (usage.get(source) or {}).get(target)
        if type(value) is int and value >= 0:
            result[target] = value
    # Anthropic's input_tokens excludes cache reads/writes; expose the total on the same basis.
    if protocol == "anthropic" and "prompt_tokens" in result:
        result["uncached_input_tokens"] = result["prompt_tokens"]
        result["prompt_tokens"] += result.get("cached_tokens", 0) + result.get("cache_write_tokens", 0)
    return result
