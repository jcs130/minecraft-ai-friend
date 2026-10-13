"""Framework-owned bounded decisions over the independent agent-mc/v1 protocol."""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from pathlib import Path

from .bridge import json_content, outcome, text_content
from .context import assemble, encode
from .fast import FastPolicy, focus_state, rule_focus
from .observations import receipt_view, spatial_text
from .perception import IMAGE_RESERVE, attach_frame, latest_png
from .planner import PlannerResponseError

PROTOCOL = "agent-mc/v1"
READ_PROTOCOL = {"task", "facts", "archive", "archive_runs"}
HIDDEN_TOOLS = {"mc_connection", "mc_events", "mc_trace", "mc_metrics", "mc_visual"}
DIRECT_TOOLS = {"mc_help", "mc_do", "mc_scout", "mc_protocol", "mc_bag", "mc_queue", "mc_blocked", "mc_stop", "mc_escape"}
READ_ACTIVITY_TOOLS = {"mc_help", "mc_scout", "mc_protocol", "mc_bag", "mc_queue", "mc_blocked", "mc_tool_help", "mc_original"}
IMMEDIATE_READ_TOOLS = READ_ACTIVITY_TOOLS - {"mc_scout"}


class ModelCallRejected(ValueError):
    """Known local rejection before any dispatch or uncertainty journal."""


def fact_fingerprint(facts):
    # The sample timestamp is useful context, but is not a decision trigger.
    return encode([(p["key"], p["text"]) for p in facts.get("parts", []) if p["key"] not in {"sample", "realclock"}])


def model_tools(catalogue):
    def numeric_field(value):
        types = value.get("type", [])
        types = [types] if isinstance(types, str) else types
        return bool({"number", "integer"}.intersection(types)) or (
            "array" in types and isinstance(value.get("items"), dict) and numeric_field(value["items"]))

    def structural(value):
        if isinstance(value, list):
            return [structural(item) for item in value]
        if isinstance(value, dict):
            result = {}
            for key, item in value.items():
                # Short parameter semantics (units, coordinate order, volume
                # limits) are needed to use a schema, not optional long manuals.
                if key == "description" and isinstance(item, str) and len(item) <= 240 and (numeric_field(value) or len(item) <= 120):
                    result[key] = item
                    continue
                if key in {"description", "title", "examples", "$comment", "default"}:
                    continue
                if key in {"properties", "patternProperties", "$defs", "definitions", "dependentSchemas"}:
                    result[key] = {name: structural(child) for name, child in item.items()}
                else:
                    result[key] = item if key in {"const", "enum"} else structural(item)
            return result
        return value

    tools = []
    available = sorted(tool["name"] for tool in catalogue if tool["name"] not in HIDDEN_TOOLS)
    advanced = [name for name in available if name not in DIRECT_TOOLS]
    for tool in sorted(catalogue, key=lambda row: row["name"]):
        if tool["name"] not in DIRECT_TOOLS:
            continue
        schema = structural(tool["inputSchema"])
        if tool["name"] == "mc_protocol":
            schema["properties"]["action"] = {"enum": sorted(READ_PROTOCOL)}
        if tool["name"] in {"mc_do", "mc_scout"}:
            schema.setdefault("properties", {})["queue"] = {"enum": ["append", "afterCheckpoint", "now"]}
        description = tool.get("description", "")[:450]
        if tool["name"] == "mc_do":
            description = "Execute real Minecraft actions: movement, collect, craft, eat, attack, build, etc. Steps run in order on the native body queue. Use mc_help for the selected skill's parameters. Default queue is append; afterCheckpoint inserts safely, now interrupts. A returned task ID means accepted, not completed."
        elif tool["name"] == "mc_scout":
            description = "Read-only observations or dry-run trials. Only the skills in steps.skill.enum are allowed. Does not collect, craft, eat, move the player or build anything. Use mc_do for real actions."
        tools.append({"type": "function", "function": {"name": tool["name"], "description": description, "parameters": schema}})
    if advanced:
        tools.append({"type": "function", "function": {"name": "mc_invoke",
                      "description": "Invoke an advanced Minecraft tool. First read its exact schema using mc_tool_help. The backend validates all arguments and returns the original execution receipt.",
                      "parameters": {"type": "object", "properties": {"name": {"enum": advanced},
                                     "arguments": {"type": "object", "additionalProperties": True}},
                                     "required": ["name", "arguments"], "additionalProperties": False}}})
    tools.append({"type": "function", "function": {"name": "mc_original",
                  "description": "Read a bounded page from an original fact or receipt artifact. Use next_offset to read more without re-inserting the full document.",
                  "parameters": {"type": "object", "properties": {"handle": {"type": "string"},
                                 "offset": {"type": "integer", "minimum": 0}, "limit": {"type": "integer", "minimum": 1, "maximum": 1000}},
                                 "required": ["handle"], "additionalProperties": False}}})
    tools.append({"type": "function", "function": {"name": "mc_tool_help",
                 "description": "Read the original tool description/schema on demand. Large nodes list JSON-pointer child paths; request a specific path for full detail.",
                 "parameters": {"type": "object", "properties": {"name": {"enum": available},
                    "path": {"type": "string", "description": "JSON pointer, e.g. /inputSchema/properties/steps"}}, "required": ["name"], "additionalProperties": False}}})
    tools.append({"type": "function", "function": {"name": "goal_report",
                  "description": "Report the current user goal as reported_done or blocked only after native tasks end. Supply observed evidence and remaining uncertainty. This is a planner report, not independently verified goal success; it yields to the next goal.",
                  "parameters": {"type": "object", "properties": {"outcome": {"enum": ["reported_done", "blocked"]},
                    "evidence": {"type": "string", "minLength": 1, "maxLength": 1200}},
                    "required": ["outcome", "evidence"], "additionalProperties": False}}})
    return tools


def tool_help(catalogue, arguments):
    value = next(tool for tool in catalogue if tool["name"] == arguments["name"])
    # Expose the same host-owned control restriction in expanded documentation.
    value = json.loads(encode(value))
    if value["name"] == "mc_protocol":
        value["inputSchema"]["properties"]["action"] = {"enum": sorted(READ_PROTOCOL)}
    path = arguments.get("path", "")
    if path and not path.startswith("/"):
        raise ValueError("Tool documentation path must be a JSON pointer")
    for token in path.split("/")[1:]:
        token = token.replace("~1", "/").replace("~0", "~")
        value = value[int(token)] if isinstance(value, list) else value[token]
    if len(encode(value).encode("utf-8")) <= 4500:
        return {"text": encode(value)}
    if isinstance(value, (dict, list)):
        pairs = value.items() if isinstance(value, dict) else enumerate(value)
        return {"text": encode({"expanded": False, "children": [
            {"path": path + "/" + str(key).replace("~", "~0").replace("/", "~1"), "type": type(item).__name__}
            for key, item in pairs]})}
    # All current scalar descriptions fit; archive_receipt retains future long ones.
    return {"text": str(value)}


def uncertain(receipt):
    evidence = (receipt.get("execution") or {}).get("evidence") or {}
    return evidence.get("outcomeUnknown") is True or evidence.get("outcomeKnown") is False or evidence.get("nativeStatus") == "unknown"


def online(status):
    # `phase: started` means engine started, not Mineflayer joined.
    return status.get("phase") == "started" and any(lamp.get("label") == "服务器" and lamp.get("state") == "online" for lamp in status.get("lamps", []))


def failure_context(catalogue, name, arguments, result):
    """Make rejected parameters actionable without adding a second model call.

    The core's flat skill schema delegates cross-field semantics to documentation.
    Generic enum errors alone do not say which values belong to which tool.
    Keep only the submitted fields' original constraints, bounded at the tail.
    """
    schema = next((t["inputSchema"] for t in catalogue if t["name"] == name), {})
    properties = schema.get("properties", {})
    fields = [(key, properties.get(key, {})) for key in arguments if key != "steps"]
    steps = arguments.get("steps")
    if isinstance(steps, list):
        step_properties = properties.get("steps", {}).get("items", {}).get("properties", {})
        keys = {key for step in steps if isinstance(step, dict) for key in step}
        fields += [("steps." + key, step_properties.get(key, {})) for key in sorted(keys)]
    notice = {"tool": name, "arguments": encode(arguments)[:1200], "error": str(result.get("text", ""))[:700],
              "next_step": "Do not repeat rejected arguments. Read mc_help for the selected skill and mc_tool_help for the tool schema; then correct the call or choose another useful action.",
              "parameter_help": {}, "original_receipts": "receipts.jsonl"}
    if name == "mc_scout" and isinstance(steps, list):
        allowed = properties.get("steps", {}).get("items", {}).get("properties", {}).get("skill", {}).get("enum", [])
        rejected = sorted({step["skill"] for step in steps if isinstance(step, dict) and isinstance(step.get("skill"), str) and step["skill"] not in allowed})
        if rejected:
            notice["next_step"] += " " + ", ".join(rejected) + " belongs to mc_do, not mc_scout. Use mc_do with the documented skill fields for real actions."
    if isinstance(steps, list) and any(isinstance(step, dict) and step.get("skill") == "observe" and step.get("mode") == "voxels" for step in steps):
        notice["next_step"] += " For voxels, omit bounds for the native default or use a small relative box such as [-2,-1,-2,2,3,2] (125 cells). Do not read the entire neighborhood to perform a simple known action."
    for key, spec in fields:
        short = {k: v for k, v in spec.items() if k in {"type", "enum", "minimum", "maximum", "minItems", "maxItems", "required"}}
        if spec.get("description"):
            short["description"] = spec["description"][:240]
        if not spec:
            short = {"documented": False, "lookup": "mc_tool_help"}
        notice["parameter_help"][key] = short
        if len(encode(notice).encode("utf-8")) > 4500:
            del notice["parameter_help"][key]
    return notice


class Controller:
    def __init__(self, bridge, decide, settings, data: Path, publish, stop_requested, commands=None, fast_policy=None):
        self.bridge, self.decide, self.settings = bridge, decide, settings
        self.data, self.publish = data, publish
        self.operator_stop = False
        self.stop_requested = lambda: self.operator_stop or stop_requested()
        self.commands = commands
        self.active_goal = None
        self.feedback_pending = False
        self.pending = {}
        self.action_owners = {}
        self.recent = []
        self.groups = []
        self.turn = None
        self.event_run = None
        self.cursor = 0
        self.last_decision = 0.0
        self.count = 0
        self.inflight_request = None
        self.last_facts = None
        self.preempted = False
        self.deferred_wake = False
        self.continuation_needed = False
        self.planner_failures = 0
        self.planner_retry_at = 0.0
        self.planner_notice = None
        self.tool_failure = None
        self.rejected_calls = {}
        self.invalid_tool_calls = 0
        self.read_activity = {}
        self.state_path = data / "host-state.json"
        self.fast_policy = fast_policy or FastPolicy(settings.fast)
        self.frame = None

    def persist(self, **changes):
        self.data.mkdir(parents=True, exist_ok=True)
        previous = json.loads(self.state_path.read_text(encoding="utf-8")) if self.state_path.exists() else {}
        temporary = self.state_path.with_suffix(".tmp")
        temporary.write_text(encode({**previous, **changes}), encoding="utf-8")
        temporary.replace(self.state_path)

    def receipt(self, value):
        if uncertain(value):
            self.persist(uncertain=True)
            raise RuntimeError("outcome_unknown: inspect the original action receipt; automatic replay is blocked")
        execution = value.get("execution")
        if execution:
            key = (execution["kind"], execution["id"])
            if execution.get("terminal") is True:
                self.pending.pop(key, None)
                self.action_owners.pop(key, None)
            else:
                self.pending[key] = execution
            self.persist(pending=list(self.pending.values()))
        self.recent.extend(e for e in value.get("events", []) if e.get("contextDelivery") != "archive-only" and not e.get("meta", {}).get("staleEpoch"))
        self.recent = self.recent[-64:]

    def current_work(self):
        if self.active_goal and self.active_goal.get("mode") == "insert":
            # Earlier work resumes natively after a checkpoint insertion. It does
            # not prevent the inserted goal from observing/reporting its own result.
            return any(self.action_owners.get(key) in {None, self.active_goal["id"]} for key in self.pending)
        return bool(self.pending)

    async def protocol(self, action, **arguments):
        return json_content(await self.bridge.call("mc_protocol", {"protocol": PROTOCOL, "action": action, **arguments}))

    async def events(self):
        page = json_content(await self.bridge.call("mc_events", {"after": self.cursor, "run": self.event_run, "limit": 64, "waitMs": 0} if self.event_run else {"after": 0, "limit": 64, "waitMs": 0}))
        if page.get("gap"):
            # Archive from the original cursor before resuming any plan; do not
            # ignore an evicted terminal/damage event and guess the task state.
            archived = await self.protocol("archive", run=page["run"], after=self.cursor, limit=64)
            page = {**archived, "run": page["run"]}
        self.event_run, self.cursor = page["run"], page["nextCursor"]
        wake, urgent = False, False
        for event in page["events"]:
            if event.get("contextDelivery") == "archive-only" or event.get("meta", {}).get("staleEpoch"):
                continue
            terminal = (event.get("execution") or {}).get("terminal") is True
            self.receipt({"events": [event], "execution": event.get("execution")})
            trigger = event.get("trigger")
            trigger = trigger.get("type") if isinstance(trigger, dict) else trigger
            wake |= terminal or trigger in {"preempt", "interrupt", "flush", "debounce"}
            urgent |= trigger in {"preempt", "interrupt"}
        return wake, urgent, page.get("hasMore", False)

    async def archive_receipt(self, request_id, name, result):
        original = encode(result)
        with (self.data / "receipts.jsonl").open("a", encoding="utf-8") as output:
            output.write(encode({"requestId": request_id, "turnId": self.turn, "tool": name, "result": result}) + "\n")
        view = receipt_view(result)
        if len(original.encode("utf-8")) <= 6000:
            return encode(view)
        # Chunks remain queryable through the existing artifact tool. JavaScript
        # measures maxLength in UTF-16; 16000 Python characters fit even with emoji.
        refs = []
        for offset in range(0, len(original), 16000):
            refs.append(json_content(await self.bridge.call("mc_artifact", {
                "action": "put", "text": original[offset:offset + 16000], "mime": "text/plain"})) ["handle"])
        # The context budget counts UTF-8 bytes, not Python characters. Chinese
        # help pages must not become a 10 KiB preview that evicts its own reply.
        preview = spatial_text(result.get("text", "")).encode("utf-8")[:2800].decode("utf-8", errors="ignore")
        return encode({"text": preview, "failed": result.get("failed"),
                       "execution": view.get("execution"),
                       "original_chunks": refs, "retrieve": "mc_original(handle,offset,limit), chunks in order"})

    async def original_page(self, arguments):
        offset, limit = arguments.get("offset", 0), arguments.get("limit", 1000)
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 1000:
            raise ValueError("Invalid original artifact page")
        raw = outcome(await self.bridge.call("mc_artifact", {"action": "get", "handle": arguments["handle"]}))
        if raw.get("failed"):
            return raw
        text = raw.get("text", "")
        end = min(len(text), offset + limit)
        return {"text": encode({"handle": arguments["handle"], "offset": offset, "text": text[offset:end],
                                "next_offset": end, "has_more": end < len(text), "total_characters": len(text)})}

    async def decide_with_events(self, messages, tools):
        task = asyncio.create_task(asyncio.wait_for(self.decide(messages, tools), self.settings.model_timeout_seconds))
        try:
            while True:
                done, _ = await asyncio.wait({task}, timeout=1)
                if self.stop_requested():
                    return None
                if self.commands and self.commands.ready(allow_goal=self.active_goal is None and not self.pending):
                    # Close this decision turn before delivering external work;
                    # a stale model completion must not replace a newly inserted job.
                    self.preempted = True
                    return None
                if done:
                    return await task
                wake, urgent, _ = await self.events()
                self.deferred_wake |= wake
                if urgent:
                    self.preempted = True
                    return None
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def dispatch(self, name, arguments, request_id):
        if name == "goal_report" and not self.active_goal:
            # A report about the standing goal is a local planning error, not a
            # failed game connection or an uncertain mutation. Preserve the reply
            # so the next decision can correct it without disconnecting the body.
            result = {"protocol": PROTOCOL, "failed": True, "execution": None,
                      "text": "No submitted goal is active. The standing goal continues; goal_report cannot finish it. Choose useful next work, or reply without a tool call to wait for a change."}
            return result, await self.archive_receipt(request_id, name, result)
        if name == "goal_report" and (not self.active_goal or self.current_work() or arguments.get("outcome") not in {"reported_done", "blocked"}
                or not isinstance(arguments.get("evidence"), str) or not 1 <= len(arguments["evidence"]) <= 1200):
            raise ValueError("goal_report_requires_active_goal_no_pending_actions_and_evidence")
        # Journal before sending: unknown delivery never gets a new request ID.
        self.inflight_request = request_id
        self.persist(inflight_request=request_id, uncertain=True)
        if name == "goal_report":
            report = {**arguments, "verified": False, "source": "planner_report",
                      "observed_facts": await self.protocol("facts"), "original_receipts": "receipts.jsonl"}
            self.commands.report_goal(self.active_goal["id"], report)
            self.active_goal = self.commands.resume_goal()
            self.feedback_pending = bool(self.active_goal and self.active_goal.get("mode") and not self.active_goal.get("queue_policy_consumed"))
            self.continuation_needed = True
            self.publish(current_goal=self.active_goal, last_goal_report=report)
            raw = {"structuredContent": {"protocol": PROTOCOL, "text": encode(report), "endsTurn": True}}
        elif name == "mc_original":
            raw = {"structuredContent": {"protocol": PROTOCOL, **await self.original_page(arguments)}}
        elif name == "mc_tool_help":
            if arguments.get("name") not in {t["name"] for t in self.bridge.tools} - HIDDEN_TOOLS:
                raise ValueError("Unavailable tool documentation")
            raw = {"structuredContent": {"protocol": PROTOCOL, **tool_help(self.bridge.tools, arguments)}}
        else:
            raw = await self.bridge.call(name, arguments, request_id=request_id, turn_id=self.turn)
        result = outcome(raw)
        if self.settings.vision_enabled:
            frame = latest_png(raw, name)
            if frame:
                self.frame = frame
                self.publish(perception={k: v for k, v in frame.items() if k not in {"url", "received_at"}})
        compact = await self.archive_receipt(request_id, name, result)
        meta = next((t for t in self.bridge.tools if t["name"] == name), {}).get("_meta", {}).get(PROTOCOL, {})
        if not raw.get("structuredContent") and {"write", "speak", "act"}.intersection(meta.get("tags", [])):
            raise RuntimeError("outcome_unknown: mutation returned no structured execution receipt")
        execution = result.get("execution")
        if execution and not execution.get("terminal"):
            self.action_owners[(execution["kind"], execution["id"])] = self.active_goal["id"] if self.active_goal else "base-goal"
        self.receipt(result)
        if name == "mc_do" and self.feedback_pending and result.get("execution") and not result.get("failed"):
            self.feedback_pending = False
            self.commands.consume_queue_policy(self.active_goal["id"])
            self.active_goal["queue_policy_consumed"] = True
            self.publish(current_goal=self.active_goal)
        self.inflight_request = None
        self.persist(inflight_request=None, uncertain=False)
        control = result.get("control") or {}
        if control.get("barrierAfter"):
            await self.protocol("ack_barrier", id=control["requestId"])
        return result, compact

    async def external_command(self):
        command = self.commands.claim(allow_goal=self.active_goal is None and not self.pending) if self.commands else None
        if not command:
            return False
        if command["kind"] == "stop":
            self.operator_stop = True
            self.commands.stop_queued()
            self.commands.finish(command["id"], {"stop_requested": True, "disconnect_confirmed": False})
            return True
        if command["kind"] == "feedback":
            if self.decide is None:
                self.commands.finish(command["id"], {"failed": True, "reason": "planner_unavailable"})
                return True
            if command["payload"]["mode"] == "replace":
                # Only an explicit replacement cancels native work. Archive its
                # actual stop receipt before adopting the new high-level goal.
                self.turn = str(uuid.uuid4())
                await self.protocol("begin_turn", id=self.turn)
                try:
                    result, _ = await self.dispatch("mc_stop", {}, command["id"])
                    if result.get("failed"):
                        self.commands.finish(command["id"], result)
                        return True
                finally:
                    if not self.inflight_request:
                        await self.protocol("end_turn", id=self.turn)
                        self.turn = None
            if not self.commands.activate_feedback(command):
                return True
            revised = command["payload"].get("revision_of")
            if revised:
                self.action_owners = {key: command["id"] if owner == revised else owner
                                     for key, owner in self.action_owners.items()}
            self.active_goal = self.commands.active_goal()
            self.feedback_pending = not self.active_goal.get("queue_policy_consumed")
            self.groups = []
            self.last_decision = 0
            self.publish(current_goal=self.active_goal)
            return True
        if command["kind"] == "goal":
            if self.decide is None:
                self.commands.report_goal(command["id"], {"outcome": "blocked", "reason": "planner_unavailable", "verified": False})
            else:
                self.active_goal = {"id": command["id"], **command["payload"]}
                self.groups = []  # Keep original receipts on disk; discard old-goal context.
                self.last_decision = 0
                self.publish(current_goal=self.active_goal)
            return True
        self.turn = str(uuid.uuid4())
        await self.protocol("begin_turn", id=self.turn)
        try:
            result, _ = await self.dispatch("mc_do", command["payload"], command["id"])
            self.commands.finish(command["id"], result)
        finally:
            if not self.inflight_request:
                await self.protocol("end_turn", id=self.turn)
                self.turn = None
        return True

    async def observe_queue(self):
        # Native readout is authoritative. Do not infer execution from inbox order.
        self.publish(native_queue=outcome(await self.bridge.call("mc_queue", {})),
                     facts=await self.protocol("facts"), pending=list(self.pending.values()))

    def prepare_call(self, calls, tools):
        if not isinstance(calls, list) or len(calls) != 1:
            raise ModelCallRejected("Return one tool call at a time to honor native barriers.")
        call = calls[0]
        if not isinstance(call, dict) or not isinstance(call.get("id"), str) or not call["id"]:
            raise ModelCallRejected("A tool call needs a non-empty string id.")
        function = call.get("function")
        if not isinstance(function, dict) or not isinstance(function.get("name"), str):
            raise ModelCallRejected("A tool call needs a function name.")
        name = function["name"]
        if name not in {tool["function"]["name"] for tool in tools}:
            raise ModelCallRejected("Unavailable Minecraft tool. Use mc_tool_help, then mc_invoke(name,arguments) for advanced capabilities; never call their names directly.")
        try:
            arguments = json.loads(function.get("arguments", ""))
        except (ValueError, TypeError):
            raise ModelCallRejected("Tool arguments must be one complete JSON object.") from None
        if not isinstance(arguments, dict):
            raise ModelCallRejected("Tool arguments must be a JSON object.")
        available = {t["name"] for t in self.bridge.tools} - HIDDEN_TOOLS
        if name == "mc_invoke":
            target = arguments.get("name")
            if not isinstance(target, str) or target not in available - DIRECT_TOOLS or not isinstance(arguments.get("arguments"), dict):
                raise ModelCallRejected("Unavailable advanced tool. Read mc_tool_help and use only the advertised advanced names.")
            name, arguments = target, arguments["arguments"]
        if name == "mc_protocol" and arguments.get("action") not in sorted(READ_PROTOCOL):
            raise ModelCallRejected("The host owns turn boundaries and cancellation; only task, facts, archive and archive_runs are exposed.")
        if self.feedback_pending:
            tags = next((t.get("_meta", {}).get(PROTOCOL, {}).get("tags", []) for t in self.bridge.tools if t["name"] == name), [])
            if name != "mc_do" and {"act", "write", "speak"}.intersection(tags):
                raise ModelCallRejected("Pending feedback must submit its body plan through mc_do.")
        return call, name, arguments

    def prepare_calls(self, calls, tools):
        if not isinstance(calls, list) or not 1 <= len(calls) <= 8:
            raise ModelCallRejected("Return at most eight calls, with any queued or acting tool last.")
        prepared = [self.prepare_call([call], tools) for call in calls]
        if len({call["id"] for call, _, _ in prepared}) != len(prepared):
            raise ModelCallRejected("Tool call ids must be unique within a response.")
        if any(name not in IMMEDIATE_READ_TOOLS for _, name, _ in prepared[:-1]):
            raise ModelCallRejected("Only immediate read tools may precede the final call. Submit one queued or acting tool last, then wait for its receipt.")
        return prepared

    async def execute_model_call(self, name, arguments):
        """Dispatch one validated call; return its result and native turn boundary."""
        queue_error = None
        if name in {"mc_do", "mc_scout"}:
            if arguments.get("queue", "append") not in {"append", "afterCheckpoint", "now"}:
                queue_error = {"failed": True, "execution": None, "origin": "controller_validation",
                    "text": "Invalid arguments: queue must be append, afterCheckpoint or now. Replacement is unavailable; no Minecraft action was dispatched. Correct the policy explicitly."}
            else:
                arguments = {**arguments, "queue": arguments.get("queue", "append")}
                if name == "mc_do" and self.active_goal and self.active_goal.get("mode") == "insert":
                    arguments["queue"] = "afterCheckpoint"
                elif name == "mc_do" and self.feedback_pending:
                    arguments["queue"] = "append"
        request_id = str(uuid.uuid4())
        rejected_key = json.dumps([name, arguments], sort_keys=True, ensure_ascii=False)
        if rejected_key in self.rejected_calls:
            # A known pre-dispatch rejection cannot be replayed by a later batch.
            self.planner_notice = "The exact same call already failed argument validation. It was NOT dispatched again. Consult mc_help/mc_tool_help and change the invalid parameters."
            self.tool_failure = self.rejected_calls[rejected_key]
            self.planner_retry_at = time.monotonic() + max(30, self.settings.min_decision_seconds)
            self.continuation_needed = True
            self.publish(planner_error="repeated_invalid_tool_call", rejected_tool=name)
            result = {"failed": True, "dispatched": False, "origin": "controller_validation", "text": self.planner_notice,
                      "previous_failure": self.tool_failure}
            return result, encode(result), True
        if queue_error:
            result = queue_error
            compact = await self.archive_receipt(request_id, name, result)
        else:
            result, compact = await self.dispatch(name, arguments, request_id)
        if not result.get("failed"):
            if name in READ_ACTIVITY_TOOLS:
                self.read_activity[name] = min(999, self.read_activity.get(name, 0) + 1)
            elif result.get("execution") and (name == "mc_do" or "act" in next(
                    (t.get("_meta", {}).get(PROTOCOL, {}).get("tags", []) for t in self.bridge.tools if t["name"] == name), [])):
                self.read_activity.clear()
            self.publish(read_activity=dict(self.read_activity))
        if result.get("failed"):
            self.tool_failure = failure_context(self.bridge.tools, name, arguments, result)
            failure = str(result.get("text", ""))
            parse_rejected = name in {"mc_do", "mc_scout"} and failure.startswith(f"[{name} 失败]") and "。你写的是 " in failure
            if not result.get("execution") and (failure.startswith("Invalid arguments:") or parse_rejected):
                if len(self.rejected_calls) >= 16:
                    self.rejected_calls.clear()
                self.rejected_calls[rejected_key] = self.tool_failure
        elif result.get("execution"):
            self.tool_failure = None
        control = result.get("control") or {}
        boundary = bool(control.get("endTurnRequested") or result.get("endsTurn") or (self.current_work() and not self.feedback_pending))
        return result, compact, boundary

    def reject_model_call(self, error):
        # Validation is not an uncertain action. Keep the exact response above,
        # let the next bounded decision correct it, and leave the body connected.
        self.invalid_tool_calls += 1
        self.planner_notice = "No tool was dispatched. " + str(error)
        with (self.data / "decisions.jsonl").open("a", encoding="utf-8") as output:
            output.write(encode({"turnId": self.turn, "rejected": str(error), "dispatched": False}) + "\n")
        delay = min(60, max(1, self.settings.min_decision_seconds) * 2 ** min(6, self.invalid_tool_calls - 1))
        self.planner_retry_at = time.monotonic() + delay
        self.continuation_needed = True
        self.publish(planner_error="invalid_model_tool_call", invalid_tool_calls=self.invalid_tool_calls)

    async def turn_once(self, goal, prefix, tools):
        self.preempted = False
        self.deferred_wake = False
        self.continuation_needed = False
        self.turn = str(uuid.uuid4())
        await self.protocol("begin_turn", id=self.turn)
        try:
            focus = None
            for round_index in range(self.settings.max_tool_rounds):
                if self.stop_requested():
                    return
                facts = await self.protocol("facts")
                state = focus_state(goal, facts, self.pending)
                if round_index == 0:
                    focus = await self.fast_policy.choose(state)
                    if focus["source"] != "rules":
                        fresh = await self.protocol("facts")
                        if fact_fingerprint(fresh) != fact_fingerprint(facts):
                            focus = {"source": "rules", "choice": rule_focus(focus_state(goal, fresh, self.pending)),
                                     "reason": "state_changed", "advisory_only": True}
                        facts = fresh
                    self.publish(fast_focus=focus)
                else:
                    focus = {"source": "rules", "choice": rule_focus(state), "advisory_only": True}
                self.last_facts = fact_fingerprint(facts)
                consumed = tuple(self.recent)
                self.deferred_wake = False
                frame = self.frame
                self.frame = None
                _, image_ready = attach_frame([{"role": "user", "content": ""}], frame)
                reserve = IMAGE_RESERVE if image_ready else 0
                try:
                    messages, budget = assemble(prefix, tools, goal, facts, self.recent, self.groups,
                        context_tokens=self.settings.context_tokens - reserve, reserved_output=self.settings.max_output_tokens,
                        planner_notice=self.planner_notice, fast_focus=focus, tool_failure=self.tool_failure, read_activity=self.read_activity)
                except ValueError:
                    if not reserve:
                        raise
                    reserve = 0
                    messages, budget = assemble(prefix, tools, goal, facts, self.recent, self.groups,
                        context_tokens=self.settings.context_tokens, reserved_output=self.settings.max_output_tokens,
                        planner_notice=self.planner_notice, fast_focus=focus, tool_failure=self.tool_failure, read_activity=self.read_activity)
                if reserve:
                    messages, _ = attach_frame(messages, frame)
                budget.update(image_reserve=reserve, total=budget["total"] + reserve, limit=self.settings.context_tokens)
                self.publish(context=budget)
                try:
                    response = await self.decide_with_events(messages, tools)
                except PlannerResponseError as error:
                    with (self.data / "decisions.jsonl").open("a", encoding="utf-8") as output:
                        output.write(encode({"turnId": self.turn, "rejected": error.diagnostic, "dispatched": False}) + "\n")
                    self.planner_failures += 1
                    self.planner_notice = "The previous model response was invalid or incomplete. No tool from it was dispatched. Return one concise, complete tool call or a short reply; split large plans into small batches."
                    self.publish(planner_error=str(error), planner_failures=self.planner_failures)
                    # This response has not dispatched a tool. Keep the native
                    # connection/reflexes alive while the planner backs off;
                    # an invalid model reply is not an unknown body outcome.
                    delay = min(300, max(5, self.settings.min_decision_seconds) * 2 ** min(self.planner_failures - 1, 6))
                    self.planner_retry_at = time.monotonic() + delay
                    self.publish(planner_retry_seconds=delay)
                    self.continuation_needed = True
                    return
                if self.stop_requested() or response is None:
                    return
                self.planner_failures = 0
                self.planner_retry_at = 0.0
                self.planner_notice = None
                self.publish(planner_error=None, planner_failures=0, planner_retry_seconds=0)
                model_status = response.get("model_status", {})
                if model_status:
                    self.publish(model_status=model_status, autonomy_running=model_status.get("route") != "unavailable")
                if model_status.get("route") == "unavailable":
                    self.planner_retry_at = time.monotonic() + 60
                    self.continuation_needed = True
                # Retain the exact model result before validation, including rejected
                # calls. Runtime diagnostics must not require replaying a game action.
                with (self.data / "decisions.jsonl").open("a", encoding="utf-8") as output:
                    output.write(encode({"turnId": self.turn, "response": response}) + "\n")
                # Events arriving during inference belong to the next request.
                consumed_ids = {id(event) for event in consumed}
                self.recent = [event for event in self.recent if id(event) not in consumed_ids]
                calls = response.get("tool_calls") or []
                self.publish(last_message=(response.get("content") or "")[:1200])
                if not calls:
                    self.invalid_tool_calls = 0
                    # A plain plan is still model history. Dropping it gives an
                    # unchanged world the same request on every idle wakeup.
                    self.groups.append([{"role": "assistant", "content": response.get("content")}])
                    self.groups = self.groups[-8:]
                    self.planner_notice = "The previous reply had no tool calls; no game action was dispatched from it. Use the current native queue and facts to decide whether to act or keep waiting."
                    return
                try:
                    prepared = self.prepare_calls(calls, tools)
                except ModelCallRejected as error:
                    self.reject_model_call(error)
                    return
                self.invalid_tool_calls = 0
                exchange = [{"role": "assistant", "content": response.get("content"), "tool_calls": calls}]
                boundary = False
                for call, name, arguments in prepared:
                    if boundary or self.stop_requested():
                        boundary = True
                        result = {"failed": True, "dispatched": False, "origin": "controller_boundary",
                                  "text": "Not dispatched: an earlier result ended the turn, failed, started native work, or stop was requested. Replan from current receipts."}
                        compact = encode(result)
                    else:
                        result, compact, boundary = await self.execute_model_call(name, arguments)
                        if len(prepared) > 1 and result.get("failed"):
                            boundary = True
                            self.continuation_needed = True
                    # Every advertised call gets a result, including the skipped
                    # suffix. Never silently drop calls or cross native barriers.
                    exchange.append({"role": "tool", "tool_call_id": call["id"], "content": compact})
                self.groups.append(exchange)
                self.groups = self.groups[-8:]
                if boundary:
                    return
            # A bounded documentation/read chain can continue in a fresh turn;
            # waiting for an unrelated world change here would strand the goal.
            self.continuation_needed = True
        finally:
            if not self.inflight_request:
                await self.protocol("end_turn", id=self.turn)
                self.turn = None

    async def run(self, goal):
        if self.commands:
            self.commands.check_uncertain()
            self.active_goal = self.commands.active_goal()
            self.feedback_pending = bool(self.active_goal and self.active_goal.get("mode") and not self.active_goal.get("queue_policy_consumed"))
        if self.state_path.exists():
            previous = json.loads(self.state_path.read_text(encoding="utf-8"))
            if previous.get("uncertain") or previous.get("pending") or previous.get("inflight_request"):
                raise RuntimeError("outcome_unknown: previous dispatch requires receipt reconciliation; the ledger was preserved")
        self.persist(stopped=False)
        try:
            await self.bridge.open()
            self.publish(phase="connecting")
            json_content(await self.bridge.call("mc_connection", {"action": "connect"}, timeout=120))
            deadline = time.monotonic() + 120
            while not self.stop_requested():
                status = json_content(await self.bridge.call("mc_connection", {"action": "status"}))
                if online(status):
                    break
                if time.monotonic() >= deadline:
                    raise RuntimeError("Minecraft did not report an online connection within 120 seconds")
                await asyncio.sleep(1)
            if self.stop_requested():
                return
            self.publish(phase="running", game_connected=True, autonomy_running=self.decide is not None, current_goal=self.active_goal)
            prefix = text_content(await self.bridge.resource("mc://environment"))
            tools = model_tools(self.bridge.tools)
            wake, urgent = True, False
            last_status_check = time.monotonic()
            if self.commands:
                await self.observe_queue()
            while not self.stop_requested() and (self.settings.max_decisions == 0 or self.count < self.settings.max_decisions):
                inserted = await self.external_command()
                if self.stop_requested():
                    break
                if inserted:
                    await self.observe_queue()
                    wake = True
                urgent |= self.feedback_pending
                event_wake, event_urgent, more = await self.events()
                wake |= event_wake
                urgent |= event_urgent
                if more:
                    await asyncio.sleep(0)
                    continue
                if time.monotonic() - last_status_check >= 10:
                    status = json_content(await self.bridge.call("mc_connection", {"action": "status"}))
                    if not online(status):
                        raise RuntimeError("connection_lost: stopped decisions; inspect authentication and connection logs")
                    last_status_check = time.monotonic()
                    if self.commands:
                        await self.observe_queue()
                elapsed = time.monotonic() - self.last_decision
                if self.decide and not self.current_work() and elapsed >= self.settings.idle_decision_seconds:
                    # Poll state without a model request when nothing has changed.
                    wake |= fact_fingerprint(await self.protocol("facts")) != self.last_facts
                if (self.decide and wake and (not self.current_work() or urgent) and elapsed >= self.settings.min_decision_seconds
                        and time.monotonic() >= self.planner_retry_at):
                    current_goal = ("Standing goal: " + goal + "\nSubmitted goal (current priority): " + self.active_goal["goal"]
                                    + "\nWhen observed facts satisfy this stage, use goal_report after native work ends to resume the standing goal; do not keep repeating a satisfied stage."
                                    if self.active_goal
                                    else "Standing goal: " + goal + "\nContinue this goal; goal_report is unavailable without a submitted goal.")
                    if self.feedback_pending:
                        current_goal += "\nCurrent user feedback takes priority. Plan through mc_do; the framework applies the requested native queue policy."
                    await self.turn_once(current_goal, prefix, tools)
                    self.count += 1
                    self.last_decision = time.monotonic()
                    wake, urgent = self.preempted or self.deferred_wake or self.continuation_needed, self.preempted
                    self.publish(decisions=self.count, pending=list(self.pending.values()))
                await asyncio.sleep(1)
            self.publish(phase="stopped" if self.stop_requested() else "budget_exhausted")
        finally:
            self.persist(stopped=True)  # Retain uncertainty and exact request IDs.
            try:
                status = json_content(await self.bridge.call("mc_connection", {"action": "disconnect"}, timeout=10))
                if status.get("phase") != "disconnected":
                    raise RuntimeError("Disconnect not confirmed")
                # Generic core disconnect explicitly stops its own action queue.
                # This must not be reused for Numen, whose remote body stays alive.
                self.persist(pending=[])
            except Exception:
                if self.pending or self.inflight_request:
                    self.persist(uncertain=True)
                self.publish(disconnect_confirmed=False)
            finally:
                await self.bridge.close()
                self.publish(game_connected=False, autonomy_running=False)
