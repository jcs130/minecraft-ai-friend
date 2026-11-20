"""Project the body's reviewed actions and attributed game messages into an external turn."""
import hashlib
from uuid import UUID


def social_communication(role, row):
    """The mailbox reader has already checked the request, speaker and original body."""
    source = row["id"]
    scope = row["channel"]
    message = {"id": source, "scope": scope, "speakerId": row["speakerId"], "listenerId": str(role.body_id),
               "text": row["message"]}
    if row.get("medium") in ("voice", "text"):
        message["medium"] = row["medium"]
    if row.get("speakerName"):
        message["speakerName"] = row["speakerName"]
    # Older game bridges use an inseparable caption/default-voice delivery.
    modes = row.get("replyModes", ["native"])
    outputs = [{"mode": mode, "scope": "private" if scope == "private" else "nearby", "sourceEventId": source}
               for mode in ("native", "text", "speech") if mode in modes]
    return {"version": 1, "messages": [message], "outputs": outputs, "maxTextChars": 140}


def _standard_schema(role, verb, keys):
    types = {"x": "number", "y": "number", "z": "number", "radius": "number", "enabled": "boolean",
             "slot": "integer", "count": "integer", "playerSlot": "integer", "quantity": "integer"}
    properties = {key: {"type": types.get(key, "string")} for key in keys}
    if verb == "chat" and "text" in properties:
        properties["text"].update(minLength=1, maxLength=role.max_speech_chars)
    if verb == "attack" and "target" in properties:
        properties["target"] = {"const": "hostile"}
        if "radius" in properties:
            properties["radius"].update(minimum=1, maximum=32)
    if verb == "use_item" and role.body_kind == "numen":
        properties["item"] = {"type": "string", "enum": role.native_items}
    optional = {"count", "playerSlot", "quantity", "inventory", "radius", "target"}
    return {"type": "object", "properties": properties, "additionalProperties": False,
            "required": [key for key in keys if key not in optional]}


def _body_tools(role, caps):
    tools = []
    for verb, details in caps.get("actions", {}).items():
        name = "body:" + verb
        if name in role.allowed_tools and not (verb == "use_item" and role.body_kind == "numen" and not role.native_items):
            description = "Attack the first visible hostile." if verb == "attack" else details.get("notes") or details["native"]
            tools.append({"tool": name, "description": description,
                          "parameters": _standard_schema(role, verb, details.get("args", []))})
    for action in caps.get("native", []):
        name = "body:native:" + action["name"]
        if name not in role.allowed_tools:
            continue
        tool = {"tool": name}
        if action.get("description"):
            tool["description"] = action["description"]
        schema = caps.get("nativeSchemas", {}).get(action.get("schema"))
        if isinstance(schema, dict):
            tool["parameters"] = schema
        if action["name"] == "task":
            tasks = [task for task in role.native_tasks if task != "touhou_little_maid:fishing"]
            if not tasks:
                continue
            tool["parameters"] = {"type": "object", "properties": {"taskId": {"type": "string", "enum": tasks}},
                                  "required": ["taskId"], "additionalProperties": False}
        tools.append(tool)
    return tools


def _message(event, body, kind):
    data = event.get("data") or {}
    if (event.get("body_id") != body or event.get("body_kind") != kind or data.get("serverAttributed") is not True
            or not isinstance(data.get("eventId"), str) or not isinstance(event.get("text"), str)
            or not data.get("speakerId") or data["speakerId"] == body):
        return None
    scope = data.get("deliveryScope")
    channel = data.get("channel")
    if scope == "addressed" and data.get("recipientId") == body and data.get("maidId") == body:
        pass
    elif scope == "nearby" and data.get("listenerId") == body and channel in ("public", "chat", "voice", "npc_chat"):
        scope = "public" if channel == "public" else "nearby"
    else:
        return None
    if channel == "private" or event.get("kind") == "whisper":
        return None
    msg = {"id": data["eventId"], "medium": "voice" if channel == "voice" else "text",
           "scope": scope, "speakerId": data["speakerId"], "listenerId": body, "text": event["text"]}
    if isinstance(data.get("speaker"), str):
        msg["speakerName"] = data["speaker"]
    return msg


def prepare_scene(role, kind, scene):
    if kind == "dialogue":
        scene["bodyTools"] = []
        scene.setdefault("communication", {"version": 1, "messages": [], "outputs": []})
        return scene
    tools = _body_tools(role, scene.get("capabilities") or {})
    names = {row["tool"] for row in tools}
    body = str(role.body_id)
    events = scene.get("currentDialogue", [])
    messages = [msg for event in events if (msg := _message(event, body, role.body_kind))]
    outputs = []
    party = ((scene.get("adventuring") or {}).get("currentParty") or {}).get("message")
    if party and party.get("eventId") and party.get("replyChannel") == "party_only":
        messages = [{"id": party["eventId"], "medium": "text", "scope": "party", "listenerId": body,
                     "speakerName": party["from"], "text": party["text"]}]
        if party.get("speakerId"):
            messages[0]["speakerId"] = party["speakerId"]
        if {"body:chat", "body:native:adventure_action"} <= names:
            outputs.append({"mode": "text", "scope": "party", "sourceEventId": party["eventId"]})
    elif "body:chat" in names:
        outputs = [{"mode": "native", "scope": "nearby", "sourceEventId": msg["id"]} for msg in messages]
        if not events:
            outputs.append({"mode": "native", "scope": "nearby"})
    scene["bodyTools"] = tools
    scene["communication"] = {"version": 1, "messages": messages, "outputs": outputs,
                              "maxTextChars": role.max_speech_chars, "receipts": scene.pop("communicationReceipts", [])}
    return scene


def translate_answer(kind, scene, answer):
    if "communication" not in answer:
        route = {}
        if kind == "plan" and isinstance(answer.get("steps"), list):
            allowed = {row["tool"] for row in scene["bodyTools"]}
            if any(isinstance(s, dict) and s.get("tool") not in allowed for s in answer["steps"]):
                raise ValueError("action_not_in_current_body_catalogue")
            if any(isinstance(s, dict) and s.get("tool") == "body:chat" for s in answer["steps"]):
                outputs = scene["communication"]["outputs"]
                if len(outputs) != 1:
                    raise ValueError("communication_source_event_required")
                route = {"residentCommunication": outputs[0]}
        return answer, route
    send = answer["communication"]
    if (set(answer) != {"communication"} or not isinstance(send, dict)
            or set(send) - {"mode", "text", "sourceEventId"}):
        raise ValueError("invalid_resident_communication")
    info = scene["communication"]
    choices = [output for output in info["outputs"] if output["mode"] == send.get("mode")
               and output.get("sourceEventId") == send.get("sourceEventId")]
    text = send.get("text")
    if (len(choices) != 1 or not isinstance(text, str) or not 1 <= len(text.strip()) <= info["maxTextChars"]
            or not text.isprintable() or "§" in text):
        raise ValueError("communication_not_available_for_this_turn")
    text = text.strip()
    result = {"reply": text} if kind == "dialogue" else {"steps": [{"tool": "body:chat", "args": {"text": text}}]}
    return result, {"residentCommunication": choices[0]}


def speech_receipt(receipt):
    row = {"requestId": receipt.request_id, "status": receipt.status, "hearingVerified": False}
    reply = receipt.data.get("reply") if isinstance(receipt.data, dict) else None
    native = reply.get("data") if isinstance(reply, dict) else None
    if not isinstance(native, dict) or native.get("operationId") != receipt.request_id:
        return row
    observed = native.get("observation") or {}
    if not isinstance(observed, dict):
        return row
    if type(observed.get("deliveredPlayers")) is int:
        row["captionRecipients"] = observed["deliveredPlayers"]
    voice = observed.get("voice") or {}
    digest = hashlib.md5(receipt.request_id.encode()).digest()  # Bukkit UUID.nameUUIDFromBytes
    if isinstance(voice, dict) and voice.get("requestId") == "r_" + str(UUID(bytes=digest, version=3)):
        row["voice"] = {k: voice[k] for k in ("requestId", "state", "reason") if k in voice}
    return row


def social_receipt(request, result):
    if not result or any(result.get(k) != request[k] for k in ("id", "speakerId", "maidId", "channel")):
        return None
    if result.get("status") not in ("answered", "failed"):
        return None
    row = {"requestId": request["id"], "status": result["status"], "hearingVerified": False}
    if type(result.get("captionRecipients")) is int:
        row["captionRecipients"] = result["captionRecipients"]
    if isinstance(result.get("speechRequestId"), str):
        row["voice"] = {"requestId": result["speechRequestId"], "state": "submitted"}
        actual = result.get("voice")
        if isinstance(actual, dict) and actual.get("requestId") == result["speechRequestId"]:
            row["voice"].update({key: actual[key] for key in ("state","packetOffers") if key in actual})
    return row
