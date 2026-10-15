"""Framework-owned bounded decisions over the independent agent-mc/v1 protocol."""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .bridge import json_content, outcome, text_content
from .context import assemble, encode
from .fast import FastPolicy, focus_state, rule_focus
from .observations import fact_preview, receipt_view, spatial_text, tool_failure_view
from .perception import IMAGE_RESERVE, attach_frame, latest_png
from .model_protocols import assistant_history
from .planner import PlannerResponseError, PlannerUnavailableError
from .tool_schema import argument_error
from .viewer_public import tool_receipt
from .death_memory import DeathMemory, TOOL as DEATH_REVIEW_TOOL, identity, lifecycle

PROTOCOL = "agent-mc/v1"
READ_PROTOCOL = {"task", "facts", "archive", "archive_runs"}
HIDDEN_TOOLS = {"mc_connection", "mc_events", "mc_trace", "mc_metrics", "mc_visual", "mc_control"}
DIRECT_TOOLS = {"mc_help", "mc_knowledge", "mc_do", "mc_scout", "mc_protocol", "mc_bag", "mc_queue", "mc_blocked", "mc_stop", "mc_escape"}
READ_ACTIVITY_TOOLS = {"mc_help", "mc_knowledge", "mc_scout", "mc_protocol", "mc_bag", "mc_queue", "mc_blocked", "mc_tool_help", "mc_original", "mc_capabilities", "mc_operations", "mc_result", "mc_notices"}
IMMEDIATE_READ_TOOLS = READ_ACTIVITY_TOOLS - {"mc_scout"}


def observation_call(name, arguments):
    """Classify native queued reads without treating their task IDs as actions."""
    if name in READ_ACTIVITY_TOOLS:
        return True
    if name != "mc_do":
        return False
    steps = arguments.get("steps")
    return isinstance(steps, list) and bool(steps) and all(
        isinstance(step, dict) and (step.get("skill") in {"observe", "check", "probe"}
                                   or (step.get("skill") == "find" and not step.get("direction")))
        for step in steps)


class ModelCallRejected(ValueError):
    """Known local rejection before any dispatch or uncertainty journal."""


def fact_fingerprint(facts):
    # The sample timestamp is useful context, but is not a decision trigger.
    return encode([(p["key"], p["text"]) for p in facts.get("parts", []) if p["key"] not in {"sample", "realclock"}])


def admission_fingerprint(facts):
    # Re-reading clocks is not new evidence that a rejected recipe/plan works.
    # Expiry below still permits checking server-side changes not in these facts.
    parts = [(p["key"], p["text"]) for p in facts.get("parts", [])
             if p["key"] not in {"sample", "realclock", "clock", "lastTask"}]
    return encode(parts) if parts else None


def model_tools(catalogue):
    def scalar_structure(value):
        if not isinstance(value, dict):
            return None
        types = value.get("type", [])
        types = [types] if isinstance(types, str) else types
        scalar = bool(types) and set(types) <= {"string", "number", "integer", "boolean", "null"}
        values = value.get("enum")
        scalar |= isinstance(values, list) and all(not isinstance(item, (list, dict)) for item in values)
        return {key: item for key, item in value.items() if key != "description"} if scalar else None

    def numeric_field(value):
        types = value.get("type", [])
        types = [types] if isinstance(types, str) else types
        return bool({"number", "integer"}.intersection(types)) or (
            "array" in types and isinstance(value.get("items"), dict) and numeric_field(value["items"]))

    def structural(value, descriptions=True):
        if isinstance(value, list):
            return [structural(item, descriptions) for item in value]
        if isinstance(value, dict):
            result = {}
            for key, item in value.items():
                # Short parameter semantics (units, coordinate order, volume
                # limits) are needed to use a schema, not optional long manuals.
                if descriptions and key == "description" and isinstance(item, str) and len(item) <= 240 and (numeric_field(value) or len(item) <= 120):
                    result[key] = item
                    continue
                if key in {"description", "title", "examples", "$comment", "default"}:
                    continue
                if key in {"properties", "patternProperties", "$defs", "definitions", "dependentSchemas"}:
                    result[key] = {name: structural(child, descriptions) for name, child in item.items()}
                else:
                    result[key] = item if key in {"const", "enum"} else structural(item, descriptions)
            return result
        return value

    tools = []
    native = any(tool["name"] == "mc_do" and "operation" in tool.get("inputSchema", {}).get("properties", {}) for tool in catalogue)
    direct = DIRECT_TOOLS | ({"mc_capabilities", "mc_operations", "mc_result", "mc_wait", "mc_cancel", "mc_notices"} if native else set())
    available = sorted(tool["name"] for tool in catalogue if tool["name"] not in HIDDEN_TOOLS)
    advanced = [name for name in available if name not in direct]
    for tool in sorted(catalogue, key=lambda row: row["name"]):
        if tool["name"] not in direct:
            continue
        schema = structural(tool["inputSchema"])
        if tool["name"] == "mc_protocol":
            schema["properties"]["action"] = {"enum": sorted(READ_PROTOCOL)}
        if tool["name"] in {"mc_do", "mc_scout"}:
            schema.setdefault("properties", {})["queue"] = {"enum": ["append", "afterCheckpoint", "now"]}
            step = schema["properties"].get("steps", {}).get("items", {})
            properties = step.get("properties", {})
            if isinstance(properties.get("skill"), dict) and "enum" in properties["skill"]:
                # Native steps use one large flat union across unrelated skills.
                # Arrays/objects are native arguments too: hiding sites, rays,
                # anchors or recipes makes even basic tools impossible to infer.
                # Keep every field's structure; manuals remain progressive.
                # Dispatch still validates the ORIGINAL complete schema.
                projected = {}
                for key, value in properties.items():
                    projected[key] = structural(value, descriptions=False)
                    if isinstance(value, dict) and (key in {"target", "direction", "mode", "count", "anchors", "bounds", "needs"}
                                                   or scalar_structure(value) is None and numeric_field(value)):
                        meaning = value.get("description")
                        if isinstance(meaning, str) and len(meaning) <= 240:
                            projected[key]["description"] = meaning
                step["properties"] = projected
        description = tool.get("description", "")[:450]
        if tool["name"] == "mc_do" and "steps" in schema.get("properties", {}):
            description = "Execute real actions using flat steps. find requires target; direction makes it walk, otherwise it only observes. collect uses block; craft uses item/count. Read mc_help for exact skill parameters. Queue append preserves work; afterCheckpoint inserts safely, now interrupts. Task IDs mean accepted, not completed."
        elif tool["name"] == "mc_scout":
            description = "Read-only observations/dry runs; use mc_do for real actions. observe requires mode: sites|voxels|rays. voxels bounds are six inclusive foot-relative integers with volume <=512; [-3,-2,-3,3,3,3] reads 294 cells. Copy the legal first-query example from an oversized rejection instead of repeatedly guessing smaller bounds."
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
    tools.append(DEATH_REVIEW_TOOL)
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
    if name == "mc_do" and not result.get("execution"):
        notice["next_step"] += " The batch was not accepted: earlier steps did not run either. Submit only the next feasible action; leave blocked optional searches and unverified dependent crafting out of that batch."
    admission = (result.get("meta") or {}).get("admission")
    if isinstance(admission, dict) and admission.get("accepted") is False:
        notice["admission"] = {key: admission[key] for key in ("accepted", "rule", "kind") if key in admission}
        notice["recovery"] = [{"tool": row["tool"], "arguments": row["arguments"],
                               "text": fact_preview(row["text"], 1800)}
                              for row in admission.get("recovery", [])[:1]
                              if isinstance(row, dict) and row.get("tool") == "mc_help"
                              and isinstance(row.get("arguments"), dict) and isinstance(row.get("text"), str)]
        notice["next_step"] += " The recovery field is the native skill reference, not a claim that its prerequisites exist. Use its exact operation/parameters and fresh inventory."
        if any(row["arguments"].get("skill") == "smelt" for row in notice["recovery"]):
            notice["next_step"] += " Cooking/charcoal requires smelt, never craft; verify a furnace and real fuel before submitting."
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
    def __init__(self, bridge, decide, settings, data: Path, publish, stop_requested, commands=None, fast_policy=None, *, context_counter=None, host_context_provider=None):
        self.bridge, self.decide, self.settings = bridge, decide, settings
        from .host_context import HostContextPort
        self.host_context_provider = host_context_provider or HostContextPort(data).read
        self.context_counter = context_counter
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
        self.continuation_ready = False
        self.planner_failures = 0
        self.planner_retry_at = 0.0
        self.planner_notice = None
        self.tool_failure = None
        self.rejected_calls = {}
        self.admission_failures = {}
        self.last_admission_facts = None
        self.invalid_tool_calls = 0
        self.unactioned_replies = 0
        self.read_activity = {}
        self.action_requests = {}
        self.action_scopes = {}
        self.native_outcomes = []
        self.state_path = data / "host-state.json"
        self.fast_policy = fast_policy or FastPolicy(settings.fast)
        self.frame = None
        self.body_lease_due = None
        self.death_memory = DeathMemory(data)
        self.game_scope = None
        self.game_facts = {"parts": []}
        self.death_waiting = False

    def observe_game_facts(self, facts):
        self.game_facts = facts
        fresh_scope = identity(facts)
        if fresh_scope != self.game_scope:
            self.recent.clear()
            self.native_outcomes.clear()
            self.groups.clear()  # Tool replies/provider replay belong to the previous game identity too.
        self.game_scope = fresh_scope
        life = lifecycle(facts)
        if isinstance(life, dict):
            self.death_waiting = life.get("phase") != "alive"
        self.publish(game_identity=self.game_scope,
                     death_episode=next(iter(self.death_memory.entries(self.game_scope, pending=True)), None))
        return not self.death_waiting

    def persist(self, **changes):
        self.data.mkdir(parents=True, exist_ok=True)
        previous = json.loads(self.state_path.read_text(encoding="utf-8")) if self.state_path.exists() else {}
        temporary = self.state_path.with_suffix(".tmp")
        temporary.write_text(encode({**previous, **changes}), encoding="utf-8")
        temporary.replace(self.state_path)

    def record_tool_failure(self, name, arguments, result, request_id=None):
        failure = failure_context(self.bridge.tools, name, arguments, result)
        failure["observation_only"] = observation_call(name, arguments)
        failure["receipt"] = {"request_id": request_id, "turn_id": self.turn,
                              "archive": "receipts.jsonl" if request_id else "decisions.jsonl"}
        self.retain_tool_failure(failure)
        return failure

    def retain_tool_failure(self, failure):
        # A failed read is not a new body plan. Keep both causes, with the body
        # rejection first so budgeted context cannot evict it in favor of a read.
        if failure.get("observation_only") and self.tool_failure and not self.tool_failure.get("observation_only"):
            self.tool_failure["observation_failure"] = {
                key: failure[key] for key in ("tool", "error", "next_step", "receipt") if key in failure}
        else:
            self.tool_failure = failure
        # The planner's full diagnostic stays local. Other hosts receive the
        # same actual error plus a reference, without private arguments/schema.
        self.publish(tool_failure=tool_failure_view(self.tool_failure))

    def receipt(self, value):
        if uncertain(value):
            self.persist(uncertain=True)
            raise RuntimeError("outcome_unknown: inspect the original action receipt; automatic replay is blocked")
        execution = value.get("execution")
        foreign_execution_id = None
        if execution:
            key = (execution["kind"], execution["id"])
            if execution.get("terminal") is True:
                submitted = self.action_requests.pop(key, None)
                submitted_scope = self.action_scopes.pop(key, None)
                if submitted and submitted_scope != self.game_scope:
                    foreign_execution_id = execution["id"]
                if submitted and submitted_scope == self.game_scope:
                    name, arguments, request_id, read_only = submitted
                    phase = execution.get("phase")
                    event = next((e for e in value.get("events", []) if (e.get("execution") or {}).get("id") == execution["id"]), {})
                    reference = {k: event[k] for k in ("run", "cursor", "ts") if k in event}
                    receipt = str((execution.get("evidence") or {}).get("receipt", ""))
                    self.native_outcomes.append({"tool": name, "execution_id": execution["id"], "phase": phase,
                        "observation_only": read_only, "goal_verified": False,
                        "receipt": spatial_text(receipt)[:450], "original_event": reference})
                    self.native_outcomes = self.native_outcomes[-6:]
                    self.publish(native_outcomes=list(self.native_outcomes))
                    if not read_only and phase == "completed":
                        # A known body task has finished. Its next useful decision
                        # need not wait for the unrelated ordinary event throttle.
                        self.continuation_ready = True
                    if not read_only and phase in {"blocked", "rejected", "partial"}:
                        failure = self.record_tool_failure(name, arguments, {"text": receipt, "execution": execution}, request_id)
                        failure["native_execution"] = {k: execution[k] for k in ("kind", "id", "phase")}
                        failure["native_event"] = reference
                        failure["next_step"] = ("The native task was accepted and has now ended with this actual outcome. "
                            "Earlier successful steps may have run. Use the latest world facts and this receipt to change the next feasible action; "
                            "do not resubmit the whole failed batch or repeat observations already answered. "
                            "Query mc_protocol(action=archive,run=original_event.run,after=original_event.cursor-1) for the full native event.")
                        self.retain_tool_failure(failure)
                    elif not read_only and phase == "completed" and self.tool_failure and self.tool_failure.get("native_execution"):
                        self.tool_failure = None
                        self.publish(tool_failure=None)
                self.pending.pop(key, None)
                self.action_owners.pop(key, None)
                self.publish(viewer_terminal={key: execution[key] for key in ("id", "terminal", "phase") if key in execution})
            else:
                self.pending[key] = execution
            self.persist(pending=list(self.pending.values()))
        for event in value.get("events", []):
            if event.get("contextDelivery") == "archive-only" or event.get("meta", {}).get("staleEpoch"):
                continue
            death = (event.get("meta") or {}).get("death")
            if isinstance(death, dict):
                episode = self.death_memory.record(event, self.game_facts, self.recent, self.native_outcomes,
                    [{"tool": item[0], "request_id": item[2], "execution_id": key[1], "observation_only": item[3]}
                     for key, item in self.action_requests.items() if self.action_scopes.get(key) == death.get("scope")])
                if episode:
                    self.death_waiting = True
                    self.continuation_needed = True
                    self.publish(death_episode=episode, game_identity=episode["scope"])
        self.recent.extend(e for e in value.get("events", []) if e.get("contextDelivery") != "archive-only" and not e.get("meta", {}).get("staleEpoch")
                           and (foreign_execution_id is None or (e.get("execution") or {}).get("id") != foreign_execution_id))
        self.recent = self.recent[-64:]

    def current_work(self):
        if self.active_goal and self.active_goal.get("mode") == "insert":
            # Earlier work resumes natively after a checkpoint insertion. It does
            # not prevent the inserted goal from observing/reporting its own result.
            return any(self.action_owners.get(key) in {None, self.active_goal["id"]} for key in self.pending)
        return bool(self.pending)

    async def protocol(self, action, **arguments):
        result = json_content(await self.bridge.call("mc_protocol", {"protocol": PROTOCOL, "action": action, **arguments}))
        if action == "facts":
            self.observe_game_facts(result)
        return result

    async def events(self):
        if self.body_lease_due is not None and time.monotonic() >= self.body_lease_due:
            lease_ms = self.settings.java_client["leaseMs"]
            json_content(await self.bridge.call("mc_control", {"action": "renew", "ttlMs": lease_ms}))
            self.body_lease_due = time.monotonic() + lease_ms / 2000
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
        if not hasattr(self, "_read_once_answers") or self._read_once_turn != self.turn:
            self._read_once_turn, self._read_once_answers = self.turn, {}
        view = receipt_view(result)
        if len(original.encode("utf-8")) > 6000:
            # Chunks remain queryable through the existing artifact tool. JavaScript
            # measures maxLength in UTF-16; 16000 Python characters fit even with emoji.
            refs = []
            for offset in range(0, len(original), 16000):
                refs.append(json_content(await self.bridge.call("mc_artifact", {
                    "action": "put", "text": original[offset:offset + 16000], "mime": "text/plain"})) ["handle"])
            # The legacy context fallback counts UTF-8 bytes, not characters. Chinese
            # help pages must not become a 10 KiB preview that evicts its own reply.
            preview = spatial_text(result.get("text", "")).encode("utf-8")[:2800].decode("utf-8", errors="ignore")
            view = {"text": preview, "failed": result.get("failed"),
                    "execution": view.get("execution"),
                    "original_chunks": refs, "retrieve": "mc_original(handle,offset,limit), chunks in order"}
            admission = (result.get("meta") or {}).get("admission")
            if isinstance(admission, dict) and admission.get("accepted") is False:
                view["meta"] = {"admission": {key: admission[key] for key in ("accepted", "rule", "kind") if key in admission}}
            if result.get("dispatched") is False:
                view.update(dispatched=False, origin=result.get("origin"))
        # The core's legacy RoundOnceGate emits this exact receipt only for these
        # primitives when their same-turn fingerprint is unchanged. It supplies
        # no reference ID. Keep at most three already-projected answers so history
        # eviction cannot leave a dangling pointer; never requery or reuse a turn.
        if name in {"mc_bag", "mc_queue", "mc_blocked"}:
            if result.get("text") == "这轮已经答过了,答案不会变,先看上一条。":
                previous = self._read_once_answers.get(name) if self.turn else None
                view["resolved_same_turn"] = previous is not None
                if previous is not None:
                    view["previous_answer"] = previous
                else:
                    view["unresolved_reference"] = "No saved substantive answer in this native turn; the referenced answer is unavailable."
            elif (self.turn and not result.get("failed") and not result.get("execution") and result.get("text")
                  and not (name == "mc_queue" and result["text"] == "[mc_queue] 队列状态未变；等任务或战斗结果事件再查。")):
                self._read_once_answers[name] = {"request_id": request_id, "turn_id": self.turn,
                                                 "answer": json.loads(encode(view))}
        return encode(view)

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
        if error := argument_error(self.bridge.tools, name, arguments):
            result = {"protocol": PROTOCOL, "failed": True, "execution": None,
                      "dispatched": False, "origin": "controller_validation", "text": error}
            return result, await self.archive_receipt(request_id, name, result)
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
        documentation = None
        if name == "mc_tool_help":
            # This is a local schema lookup. A guessed field/index has not sent
            # anything to the body and must not poison its uncertainty journal.
            available = {tool["name"] for tool in self.bridge.tools} - HIDDEN_TOOLS
            if (isinstance(arguments.get("name"), str) and arguments["name"] in available
                    and isinstance(arguments.get("path", ""), str)):
                try:
                    documentation = tool_help(self.bridge.tools, arguments)
                except (LookupError, TypeError, ValueError):
                    pass
            if documentation is None:
                result = {"protocol": PROTOCOL, "failed": True, "execution": None,
                          "dispatched": False, "origin": "controller_validation",
                          "text": "Invalid arguments: mc_tool_help requires an available tool and a documented JSON-pointer path. No native call was dispatched. Read mc_tool_help(name) first and copy an actual child path; for a skill manual use mc_help(skill), not a skill name as a schema property."}
                return result, await self.archive_receipt(request_id, name, result)
        # Journal before sending: unknown delivery never gets a new request ID.
        self.inflight_request = request_id
        self.persist(inflight_request=request_id, uncertain=True)
        if name == "goal_report":
            report = {**arguments, "verified": False, "source": "planner_report",
                      "observed_facts": await self.protocol("facts"), "original_receipts": "receipts.jsonl"}
            finished_goal = self.active_goal["id"]
            self.commands.report_goal(finished_goal, report)
            self.active_goal = self.commands.resume_goal()
            self.continuation_ready |= self.active_goal is None or self.active_goal["id"] != finished_goal
            self.feedback_pending = bool(self.active_goal and self.active_goal.get("mode") and not self.active_goal.get("queue_policy_consumed"))
            self.continuation_needed = True
            self.publish(current_goal=self.active_goal, last_goal_report=report)
            raw = {"structuredContent": {"protocol": PROTOCOL, "text": encode(report), "endsTurn": True}}
        elif name == "mc_original":
            raw = {"structuredContent": {"protocol": PROTOCOL, **await self.original_page(arguments)}}
        elif name == "mc_tool_help":
            raw = {"structuredContent": {"protocol": PROTOCOL, **documentation}}
        elif name == "death_review":
            try:
                detail = self.death_memory.execute(self.game_scope, arguments)
                raw = {"structuredContent": {"protocol": PROTOCOL, "text": encode(detail)}}
            except ValueError as error:
                raw = {"structuredContent": {"protocol": PROTOCOL, "failed": True, "text": str(error)}}
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
        if execution:
            key = (execution["kind"], execution["id"])
            if len(self.action_requests) >= 64 and key not in self.action_requests:
                old = next(iter(self.action_requests))
                self.action_requests.pop(old)
                self.action_scopes.pop(old, None)
            self.action_requests[key] = (name, json.loads(encode(arguments)), request_id, observation_call(name, arguments))
            self.action_scopes[key] = self.game_scope
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
            self.planner_retry_at = 0.0
            self.unactioned_replies = 0
            self.planner_notice = None
            # A host's revision continues the same stage and still needs its
            # exact help/failure exchanges. New intent discards old-goal context.
            if not (revised and command["payload"].get("origin") == "host_review"):
                self.groups = []
            self.last_decision = 0
            self.publish(current_goal=self.active_goal, unactioned_replies=0, planner_retry_seconds=0)
            return True
        if command["kind"] == "goal":
            if self.decide is None:
                self.commands.report_goal(command["id"], {"outcome": "blocked", "reason": "planner_unavailable", "verified": False})
            else:
                self.active_goal = {"id": command["id"], **command["payload"]}
                self.planner_retry_at = 0.0
                self.unactioned_replies = 0
                self.planner_notice = None
                self.groups = []  # Keep original receipts on disk; discard old-goal context.
                self.last_decision = 0
                self.publish(current_goal=self.active_goal, unactioned_replies=0, planner_retry_seconds=0)
            return True
        self.turn = str(uuid.uuid4())
        await self.protocol("begin_turn", id=self.turn)
        try:
            result, _ = await self.dispatch("mc_do", command["payload"], command["id"])
            self.publish(viewer_action=tool_receipt("mc_do", command["payload"], result))
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
        if error := argument_error(self.bridge.tools, name, arguments):
            self.record_tool_failure(name, arguments, {"text": error})
            raise ModelCallRejected(error)
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
        if self.death_waiting:
            self.continuation_needed = True
            result = {"failed": True, "dispatched": False, "origin": "controller_boundary",
                      "text": "Death recovery is awaiting respawn and fresh facts. No action was dispatched."}
            return result, encode(result), True
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
        prior_admission = self.admission_failures.get(rejected_key)
        if prior_admission and (prior_admission["facts"] != self.last_admission_facts
                                or time.monotonic() - prior_admission["at"] >= 120):
            self.admission_failures.pop(rejected_key)
            prior_admission = None
        if prior_admission and self.last_admission_facts is not None:
            self.planner_notice = "The native executor already rejected this identical plan with unchanged world facts. It was NOT dispatched again. Use the retained native recovery reference to choose one feasible action, or query the specific missing prerequisite. Clocks and new tool-call IDs do not make a rejected plan feasible."
            self.retain_tool_failure(prior_admission["failure"])
            self.planner_retry_at = time.monotonic() + max(30, self.settings.min_decision_seconds)
            self.continuation_needed = True
            self.publish(planner_error="repeated_admission_rejection", rejected_tool=name,
                         planner_retry_seconds=max(30, self.settings.min_decision_seconds))
            result = {"failed": True, "dispatched": False, "origin": "controller_validation",
                      "text": self.planner_notice, "previous_failure": self.tool_failure}
            compact = await self.archive_receipt(request_id, name, result)
            return result, compact, True
        if rejected_key in self.rejected_calls:
            # A known pre-dispatch rejection cannot be replayed by a later batch.
            self.planner_notice = "The exact same call already failed argument validation. It was NOT dispatched again. Consult mc_help/mc_tool_help and change the invalid parameters."
            self.retain_tool_failure(self.rejected_calls[rejected_key])
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
        self.publish(viewer_action=tool_receipt(name, arguments, result))
        read_only = observation_call(name, arguments)
        if not result.get("failed"):
            if read_only:
                self.read_activity[name] = min(999, self.read_activity.get(name, 0) + 1)
            elif result.get("execution") and (name == "mc_do" or "act" in next(
                    (t.get("_meta", {}).get(PROTOCOL, {}).get("tags", []) for t in self.bridge.tools if t["name"] == name), [])):
                self.read_activity.clear()
                self.unactioned_replies = 0
                self.publish(unactioned_replies=0)
            self.publish(read_activity=dict(self.read_activity))
        if result.get("failed"):
            failure_notice = self.record_tool_failure(name, arguments, result, request_id)
            admission = failure_notice.get("admission") or {}
            if not result.get("execution") and admission.get("kind") in {"correction", "repeat"}:
                if len(self.admission_failures) >= 16:
                    self.admission_failures.pop(next(iter(self.admission_failures)))
                self.admission_failures[rejected_key] = {"failure": failure_notice,
                    "facts": self.last_admission_facts, "at": time.monotonic()}
            failure = str(result.get("text", ""))
            parse_rejected = name in {"mc_do", "mc_scout"} and failure.startswith(f"[{name} 失败]") and "。你写的是 " in failure
            if not result.get("execution") and (failure.startswith("Invalid arguments:") or parse_rejected):
                if len(self.rejected_calls) >= 16:
                    self.rejected_calls.clear()
                self.rejected_calls[rejected_key] = failure_notice
        elif result.get("execution") and (not read_only and not (self.tool_failure or {}).get("native_execution") or (
                self.tool_failure and self.tool_failure.get("observation_only")
                and self.tool_failure["tool"] == name)):
            # A corrected observation can resolve its own invalid parameters.
            # An unrelated queued read cannot resolve a rejected body plan.
            self.tool_failure = None
            self.publish(tool_failure=None)
        elif result.get("execution") and self.tool_failure:
            # Correcting the intervening read resolves only that read's error.
            read_failure = self.tool_failure.get("observation_failure", {})
            if read_failure.get("tool") == name:
                self.tool_failure.pop("observation_failure")
                self.publish(tool_failure=tool_failure_view(self.tool_failure))
        control = result.get("control") or {}
        execution = result.get("execution") or {}
        queued = bool(execution and execution.get("terminal") is not True)
        boundary = bool(queued or control.get("endTurnRequested") or result.get("endsTurn")
                        or (self.current_work() and not self.feedback_pending))
        return result, compact, boundary

    def reject_model_call(self, error, response=None):
        # Validation is not an uncertain action. Keep the exact response above,
        # let the next bounded decision correct it, and leave the body connected.
        self.invalid_tool_calls += 1
        self.planner_notice = "No tool was dispatched. " + str(error)
        calls = response.get("tool_calls") if isinstance(response, dict) else None
        # Complete wire envelopes can carry their exact rejection into the next
        # request. Never serialize malformed IDs/functions as model tool history.
        if (isinstance(calls, list) and 1 <= len(calls) <= 8
                and all(isinstance(call, dict) and call.get("type", "function") == "function"
                        and isinstance(call.get("id"), str) and call["id"]
                        and isinstance(call.get("function"), dict)
                        and isinstance(call["function"].get("name"), str) and call["function"]["name"]
                        and isinstance(call["function"].get("arguments"), str) for call in calls)
                and len({call["id"] for call in calls}) == len(calls)):
            failure = encode({"failed": True, "dispatched": False, "origin": "controller_validation",
                              "text": self.planner_notice})
            self.groups.append([assistant_history(response), *[
                {"role": "tool", "tool_call_id": call["id"], "content": failure} for call in calls]])
            self.groups = self.groups[-8:]
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
        self.continuation_ready = False  # Consume one meaningful handoff, never a polling loop.
        self.turn = str(uuid.uuid4())
        await self.protocol("begin_turn", id=self.turn)
        try:
            focus = None
            for round_index in range(self.settings.max_tool_rounds):
                if self.stop_requested():
                    return
                facts = await self.protocol("facts")
                if self.death_waiting:
                    self.continuation_needed = True
                    return
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
                self.last_admission_facts = admission_fingerprint(facts)
                consumed = tuple(self.recent)
                self.deferred_wake = False
                frame = self.frame
                self.frame = None
                _, image_ready = attach_frame([{"role": "user", "content": ""}], frame)
                reserve = IMAGE_RESERVE if image_ready else 0
                from .host_context import metadata as host_context_metadata
                host_context = self.host_context_provider(self.commands.intent_revision() if self.commands else 0)
                self.publish(host_context=host_context_metadata(host_context))
                try:
                    messages, budget = assemble(prefix, tools, goal, facts, self.recent, self.groups,
                        context_tokens=self.settings.context_tokens - reserve, reserved_output=self.settings.max_output_tokens,
                        planner_notice=self.planner_notice, fast_focus=focus, tool_failure=self.tool_failure, read_activity=self.read_activity, native_outcomes=self.native_outcomes,
                        context_counter=self.context_counter, host_context=host_context, death_memory=self.death_memory.context(self.game_scope))
                except ValueError:
                    if not reserve:
                        raise
                    reserve = 0
                    messages, budget = assemble(prefix, tools, goal, facts, self.recent, self.groups,
                        context_tokens=self.settings.context_tokens, reserved_output=self.settings.max_output_tokens,
                        planner_notice=self.planner_notice, fast_focus=focus, tool_failure=self.tool_failure, read_activity=self.read_activity, native_outcomes=self.native_outcomes,
                        context_counter=self.context_counter, host_context=host_context, death_memory=self.death_memory.context(self.game_scope))
                if reserve:
                    messages, _ = attach_frame(messages, frame)
                budget.update(image_reserve=reserve, total=budget["total"] + reserve, limit=self.settings.context_tokens)
                self.publish(context=budget)
                try:
                    response = await self.decide_with_events(messages, tools)
                except (PlannerResponseError, PlannerUnavailableError) as error:
                    with (self.data / "decisions.jsonl").open("a", encoding="utf-8") as output:
                        output.write(encode({"turnId": self.turn, "rejected": error.diagnostic, "dispatched": False}) + "\n")
                    self.planner_failures += 1
                    if isinstance(error, PlannerUnavailableError):
                        self.planner_notice = "The previous planning request was temporarily unavailable. No tool from it was dispatched. Use the latest facts and original receipts to continue; do not assume an action ran or replay pending native work."
                    else:
                        self.planner_notice = "The previous model response was invalid or incomplete. No tool from it was dispatched. Return one concise, complete tool call or a short reply; split large plans into small batches."
                    self.publish(planner_error=str(error), planner_failures=self.planner_failures)
                    # This response has not dispatched a tool. Keep the native
                    # connection/reflexes alive while the planner backs off;
                    # a failed inference is not an unknown body outcome.
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
                self.publish(last_message=(response.get("content") or "")[:1200], viewer_decision_at=datetime.now(timezone.utc).isoformat())
                if not calls:
                    self.invalid_tool_calls = 0
                    # A plain plan is still model history. Dropping it gives an
                    # unchanged world the same request on every idle wakeup.
                    self.groups.append([assistant_history(response)])
                    self.groups = self.groups[-8:]
                    # Text is not a native task or a completed standing goal.
                    # Revisit it even when an idle world never emits a change,
                    # with a growing pause instead of an inference busy-loop.
                    if model_status.get("route") != "unavailable":
                        self.unactioned_replies += 1
                        delay = min(300, max(5, self.settings.idle_decision_seconds, self.settings.min_decision_seconds)
                                    * 2 ** min(6, self.unactioned_replies - 1))
                        self.planner_retry_at = time.monotonic() + delay
                        self.continuation_needed = True
                        self.publish(planner_retry_seconds=delay, unactioned_replies=self.unactioned_replies)
                    self.planner_notice = f"{self.unactioned_replies} replies without a subsequent accepted game action. The previous reply had no tool calls; no game action was dispatched from it. The standing goal remains active. Use current facts and receipts to choose useful next work; if waiting, explain the condition preventing action."
                    return
                try:
                    prepared = self.prepare_calls(calls, tools)
                except ModelCallRejected as error:
                    self.reject_model_call(error, response)
                    return
                self.invalid_tool_calls = 0
                exchange = [assistant_history(response)]
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

    def goal_prompt(self, standing_goal):
        text = "Standing goal: " + standing_goal
        if not self.active_goal:
            return text + "\nContinue this goal; goal_report is unavailable without a submitted goal."
        active = self.active_goal
        origin = active.get("origin", "unknown")
        user = self.commands.current_user_goal(active["id"]) if self.commands else (active if origin == "user" else None)
        if user:
            text += "\nCurrent user goal (priority over proposed stages): " + user["goal"]
        if origin == "host_review":
            text += "\nHost review proposed stage: " + active["goal"]
            text += "\nThis stage is model judgment, not user feedback. Keep it subordinate to the current user goal and standing goal; do not promote unrelated remembered tasks into current intent."
        elif origin != "user":
            text += "\nSubmitted stage (origin unknown): " + active["goal"]
            text += "\nUnknown origin is not evidence of a new user instruction; preserve the standing goal and any explicit current user goal."
        text += "\nWhen observed facts satisfy this stage, use goal_report after native work ends to resume its parent goal or the standing goal; do not keep repeating a satisfied stage."
        if self.feedback_pending:
            if origin == "user":
                text += "\nCurrent user feedback takes priority."
            text += "\nPlan through mc_do; the framework applies the requested native queue policy at its safe checkpoint."
        return text

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
            if self.settings.body_provider == "java-client":
                advertised = {tool["name"] for tool in self.bridge.tools}
                if not {"mc_control", "mc_operations", "mc_capabilities"}.issubset(advertised):
                    raise RuntimeError("java_client_backend_required: use an explicit core build advertising native client control; refusing Mineflayer fallback")
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
            if self.settings.body_provider == "java-client":
                for name in ("mc_capabilities", "mc_operations", "mc_help"):
                    inspected = outcome(await self.bridge.call(name, {}))
                    if inspected.get("failed"):
                        raise RuntimeError("Java client capability inspection failed")
                lease_ms = self.settings.java_client["leaseMs"]
                json_content(await self.bridge.call("mc_control", {"action": "claim", "ttlMs": lease_ms}))
                self.body_lease_due = time.monotonic() + lease_ms / 2000
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
                if event_urgent:
                    # Fresh danger may interrupt a planning pause. Ordinary
                    # observation completions must not bypass its backoff.
                    self.planner_retry_at = 0.0
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
                if (self.decide and wake and (not self.current_work() or urgent)
                        and (elapsed >= self.settings.min_decision_seconds or self.continuation_ready)
                        and time.monotonic() >= self.planner_retry_at):
                    current_goal = self.goal_prompt(goal)
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
