"""Framework-owned bounded decisions over the independent agent-mc/v1 protocol."""

from __future__ import annotations

import asyncio
import copy
import json
import os
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .bridge import json_content, outcome, text_content
from .container_recovery import ContainerRecovery
from .context import (
    assemble,
    coalesce_rejected,
    encode,
    outcome_eviction_index,
    retain_events,
)
from .context_counter import CounterUnavailable, count_input
from .context_evidence import outcome_id, outcome_message, project_values
from .death_memory import TOOL as DEATH_REVIEW_TOOL
from .death_memory import DeathMemory, identity, lifecycle, recovery_state
from .decision_profiles import profile_view
from .effects import EffectRecovery, body_changed
from .fast import FastPolicy, focus_state, rule_focus
from .model_protocols import assistant_history
from .observations import (
    body_event_view,
    fact_preview,
    native_outcome_view,
    receipt_view,
    spatial_observations,
    spatial_text,
    terminal_step_outcomes,
    tool_failure_view,
)
from .perception import IMAGE_RESERVE, attach_frame, latest_png
from .planner import (
    PlannerRequestRejectedError,
    PlannerResponseError,
    PlannerUnavailableError,
    PlannerDeadlineError,
)
from .reply_quality import repeated_plain_reply
from .stage_applicability import body_baseline, historical_proposal, inapplicable_reason
from .tool_schema import argument_error, provider_schema
from .viewer_public import tool_receipt

PROTOCOL = "agent-mc/v1"
READ_PROTOCOL = {"task", "facts", "archive", "archive_runs"}
HIDDEN_TOOLS = {"mc_connection", "mc_events", "mc_trace", "mc_metrics", "mc_control"}
DIRECT_TOOLS = {"mc_help", "mc_knowledge", "mc_do", "mc_scout", "mc_protocol", "mc_bag", "mc_queue", "mc_blocked", "mc_stop", "mc_escape", "mc_tool_help", "mc_messages"}
READ_ACTIVITY_TOOLS = {"mc_help", "mc_knowledge", "mc_scout", "mc_protocol", "mc_bag", "mc_queue", "mc_blocked", "mc_tool_help", "mc_original", "mc_capabilities", "mc_operations", "mc_result", "mc_notices", "mc_messages"}
IMMEDIATE_READ_TOOLS = READ_ACTIVITY_TOOLS - {"mc_scout"}
REUSABLE_IMMEDIATE_READS = {"mc_bag", "mc_queue", "mc_blocked"}
READ_RECOVERY_SECONDS = 300


def conversation_event(event):
    """Only native conversation wakeups, never progress or telemetry snapshots."""
    trigger = event.get("trigger")
    trigger = trigger.get("type") if isinstance(trigger, dict) else trigger
    return (event.get("type") in {"minecraft.chat", "chat"}
            and trigger in {"flush", "debounce", "preempt", "interrupt"}
            and event.get("contextDelivery") != "archive-only"
            and not (event.get("meta") or {}).get("staleEpoch"))


def observation_call(name, arguments):
    """Classify native queued reads without treating their task IDs as actions."""
    if name in READ_ACTIVITY_TOOLS or empty_catalogue_query(name, arguments):
        return True
    if name != "mc_do":
        return False
    steps = arguments.get("steps")
    return isinstance(steps, list) and bool(steps) and all(
        isinstance(step, dict) and (step.get("skill") in {"observe", "check", "probe", "look"}
                                   or (step.get("skill") == "build" and step.get("dryRun") is True)
                                   or (step.get("skill") == "find" and not step.get("direction")))
        for step in steps)


def empty_catalogue_query(name, arguments):
    """Only the two native mixed tools' exact empty calls are catalogue reads."""
    return name in {"mc_blueprint", "mc_map"} and arguments == {}


def spatial_read_key(name, arguments):
    """Reuse queued reads/previews across ports, never a mixed body-action plan."""
    steps = arguments.get("steps")
    if name not in {"mc_do", "mc_scout"} or not isinstance(steps, list) or not steps:
        return None
    # Turning to inspect is read activity, but it still changes the camera.
    # Never replace that native operation with a previously cached view.
    if any(isinstance(step, dict) and step.get("skill") == "look" for step in steps):
        return None
    if name != "mc_scout" and not observation_call(name, arguments):
        return None
    return json.dumps(steps, sort_keys=True, ensure_ascii=False)


class ModelCallRejected(ValueError):
    """Known local rejection before any dispatch or uncertainty journal."""


class ToolJSONRejected(ModelCallRejected):
    """A complete tool envelope whose argument JSON failed before dispatch."""

    def __init__(self, message, diagnostic=None):
        super().__init__(message)
        self.diagnostic = diagnostic or {}


def fact_fingerprint(facts):
    # The sample timestamp is useful context, but is not a decision trigger.
    return encode([(p["key"], p["text"]) for p in facts.get("parts", []) if p["key"] not in {"sample", "realclock"}])


def admission_fingerprint(facts):
    # Re-reading clocks is not new evidence that a rejected recipe/plan works.
    # Expiry below still permits checking server-side changes not in these facts.
    parts = [(p["key"], p["text"]) for p in facts.get("parts", [])
             if p["key"] not in {"sample", "realclock", "clock", "lastTask"}]
    return encode(parts) if parts else None


def model_tools(catalogue, *, context_mode="compact"):
    # Native catalogues can repeat a tool. Dispatch/help use the first schema;
    # advertise that same contract exactly once to providers that reject names.
    unique = {}
    for tool in catalogue:
        unique.setdefault(tool["name"], tool)
    catalogue = list(unique.values())
    def numeric_field(value):
        types = value.get("type", [])
        types = [types] if isinstance(types, str) else types
        return bool({"number", "integer"}.intersection(types)) or (
            "array" in types and isinstance(value.get("items"), dict) and numeric_field(value["items"]))

    def structural(value, descriptions=True):
        if context_mode == "full":
            import copy
            return copy.deepcopy(value)
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
    if context_mode == "full":
        # The native manuals use native names for goals, methods, memory and
        # tactics. Full mode must expose those actual contracts, not silently
        # replace all of them with one opaque router. Keep the old router as a
        # compatibility entry; original validation/ownership still applies.
        direct |= set(available)
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
                # The first projection already keeps concise units/applicability.
                # Do not strip them again for scalar flat-union arguments.
                original = tool["inputSchema"]["properties"]["steps"]["items"]["properties"]
                target = original.get("target", {}).get("description")
                if isinstance(target, str) and len(target) <= 320:
                    # The genuine shared target doc also describes use/ride/etc.
                    # Retain it intact rather than inventing a find-only ID rule.
                    properties["target"]["description"] = target
        description = tool.get("description", "") if context_mode == "full" else tool.get("description", "")[:450]
        if tool["name"] == "mc_do" and "steps" in schema.get("properties", {}):
            description = "Execute real actions using flat steps. find requires target; direction makes it walk, otherwise it only observes. collect uses block; craft uses item/count. Read mc_help for exact skill parameters. Queue append preserves work; afterCheckpoint inserts safely, now interrupts. Task IDs mean accepted, not completed."
        elif tool["name"] == "mc_scout":
            description = "Read-only observations/dry runs; use mc_do for real actions. observe requires mode: sites|voxels|rays. voxels bounds are six inclusive foot-relative integers with volume <=512; [-3,-2,-3,3,3,3] reads 294 cells. Copy the legal first-query example from an oversized rejection instead of repeatedly guessing smaller bounds."
        if context_mode == "full" and tool["name"] in {"mc_do", "mc_scout"}:
            description += "\n" + tool.get("description", "")
        tools.append({"type": "function", "function": {"name": tool["name"], "description": description, "parameters": provider_schema(schema)}})
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
    if "mc_tool_help" not in available:
        # Compatibility for older/native bodies only. New cores own discovery;
        # preserve their exact full/path/index contract instead of shadowing it.
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
    if value["name"] == "mc_visual":
        value["planner_guidance"] = (
            "Use supported synchronous raw PNG when useful; actual modes and limits come from this schema and body receipt. "
            "Only a fresh attached image is visual evidence. mc_view_map images are maps, not camera scenes; "
            "overview covers observed/historical terrain, not unknown terrain. On capture failure or text-model fallback, "
            "reason from fresh text facts without claiming to have seen a screenshot. Background image delivery is not wired.")
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
    if status.get("phase") != "started":
        return False
    connection = status.get("connection")
    if isinstance(connection, dict) and type(connection.get("ready")) is bool:
        return connection["ready"]
    return any(lamp.get("label") == "服务器" and lamp.get("state") == "online" for lamp in status.get("lamps", []))


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
    malformed_steps = ("steps" in arguments and not isinstance(steps, list)
                       and properties.get("steps", {}).get("type") == "array")
    if malformed_steps:
        fields.insert(0, ("steps", properties.get("steps", {})))
    if isinstance(steps, list):
        step_properties = properties.get("steps", {}).get("items", {}).get("properties", {})
        keys = {key for step in steps if isinstance(step, dict) for key in step}
        fields += [("steps." + key, step_properties.get(key, {})) for key in sorted(keys)]
    notice = {"tool": name, "arguments": encode(arguments)[:1200], "error": str(result.get("text", ""))[:700],
              "next_step": "Do not repeat rejected arguments. Read mc_help for the selected skill and mc_tool_help for the tool schema; then correct the call or choose another useful action.",
              "parameter_help": {}, "original_receipts": "receipts.jsonl"}
    if malformed_steps:
        notice["next_step"] += " steps must be a JSON array of step objects; JSON text inside a string is not an array. No parsing, repair or dispatch was performed."
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
        if key == "steps":
            short.pop("description", None)  # The full skill manual is progressive.
            if isinstance(spec.get("items"), dict) and "type" in spec["items"]:
                short["items"] = {"type": spec["items"]["type"]}
            short["schema"] = {"tool": "mc_tool_help", "arguments": {
                "name": name, "path": ("/properties/steps" if any(tool.get("name") == "mc_tool_help" for tool in catalogue)
                                        else "/inputSchema/properties/steps")}}
        if not spec:
            short = {"documented": False, "lookup": "mc_tool_help"}
        notice["parameter_help"][key] = short
        if len(encode(notice).encode("utf-8")) > 4500:
            del notice["parameter_help"][key]
    return notice


class Controller:
    def __init__(self, bridge, decide, settings, data: Path, publish, stop_requested, commands=None, fast_policy=None, *, context_counter=None, host_context_provider=None, recent_context_provider=None, runtime_session=None, profile_decide=None):
        self.bridge, self.decide, self.settings = bridge, decide, settings
        self.profile_decide=profile_decide
        self.profile_death_id=None
        from .host_context import HostContextPort
        self.host_context_port = HostContextPort(data)
        self.host_context_provider = host_context_provider if host_context_provider is not None else self.host_context_port.read
        self.recent_context_provider = recent_context_provider if recent_context_provider is not None else self.host_context_port.read_recent
        self.runtime_session = runtime_session
        self.context_counter = context_counter
        self.data, self.publish = data, publish
        self.operator_stop = False
        self.stop_requested = lambda: self.operator_stop or stop_requested()
        self.commands = commands
        self.active_goal = None
        self.historical_goal = None
        self.feedback_pending = False
        self.pending = {}
        self.action_owners = {}
        self.recent = []
        self.groups = []
        self.outcome_history_ids = set()
        self.turn = None
        self.event_run = None
        self._event_poll = None
        self._deferred_event_drain = False
        self.cursor = 0
        self.last_decision = 0.0
        self.count = 0
        self.inflight_request = None
        self.last_facts = None
        self.preempted = False
        self.deferred_wake = False
        self.continuation_needed = False
        self.continuation_ready = False
        self.conversation_continuation = False
        self.lookahead_used = set()
        self.lookahead_anchor = None
        self.lookahead_invalidated = False
        self.model_started_at = None
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
        self.spatial_handoffs = 0
        self.observation_reads = {}
        self.observation_requests = {}
        self.read_answers = {}
        self.read_recovery_tools = {}
        self.effect_recovery = EffectRecovery()
        self.container_recovery = ContainerRecovery()
        self.skill_references = {}
        self.action_requests = {}
        self.action_scopes = {}
        self.native_outcomes = []
        self.body_events = []
        self.state_path = data / "host-state.json"
        self.fast_policy = fast_policy or FastPolicy(settings.fast)
        self.frame = None
        self.body_lease_due = None
        self.death_memory = DeathMemory(data)
        self.game_scope = None
        self.game_facts = {"parts": []}
        self.death_waiting = False
        self.death_recovery = None
        self.death_epoch = 0
        self.turn_death_epoch = 0

    def observe_game_facts(self, facts):
        if body_changed(self.game_facts, facts):
            self.clear_read_activity()
        self.game_facts = facts
        fresh_scope = identity(facts)
        life = lifecycle(facts)
        if fresh_scope != self.game_scope:
            self.read_activity.clear()
            self.observation_reads.clear()
            self.spatial_handoffs = 0
            self.lookahead_used.clear()
            self.lookahead_invalidated |= self.lookahead_anchor is not None
            self.observation_requests.clear()
            self.read_answers.clear()
            self.read_recovery_tools.clear()
            self.recent.clear()
            self.native_outcomes.clear()
            self.body_events.clear()
            self.publish(native_outcomes=[], body_events=[], read_recovery=None)
            self.groups.clear()  # Tool replies/provider replay belong to the previous game identity too.
            self.outcome_history_ids.clear()
            if not self.death_recovery:
                # History alone cannot fence a fresh connection, whose native
                # lifecycle starts alive without any episode ID. Hydrate only
                # an episode still attested by this actual body's lifecycle.
                latest = next(iter(self.death_memory.entries(fresh_scope)), None)
                if latest and isinstance(life, dict) and life.get("episodeId") == latest["id"]:
                    self.death_recovery = latest
        self.game_scope = fresh_scope
        if self.death_recovery:
            body = recovery_state(facts)
            self.death_waiting = not (fresh_scope == self.death_recovery["scope"]
                and isinstance(life, dict) and life.get("phase") == "alive"
                and life.get("episodeId") == self.death_recovery["id"]
                and body.get("inventorySynced") is True
                and type(body.get("health")) in {int, float} and body["health"] > 0)
        elif isinstance(life, dict):
            self.death_waiting = life.get("phase") != "alive"
        self.synchronize_goals()
        self.publish(facts=facts, game_identity=self.game_scope,
                     body_death_episode_id=life.get("episodeId") if isinstance(life, dict) else None,
                     death_episode=self.death_memory.current_episode(self.game_scope, facts, pending=True))
        return not self.death_waiting

    def stage_baseline(self):
        latest = next(iter(self.death_memory.entries(self.game_scope)), None)
        return body_baseline(self.game_facts, latest)

    def synchronize_goals(self):
        baseline = self.stage_baseline()
        if self.commands:
            changed = self.commands.reassess_host_stages(baseline)
            self.active_goal = self.commands.active_goal()
            self.historical_goal = self.commands.historical_goal(baseline)
        else:
            changed = bool(inapplicable_reason(self.active_goal, baseline))
            if changed:
                self.historical_goal = historical_proposal(self.active_goal, baseline)
                self.active_goal = None
        if changed:
            self.groups.clear()  # Old exchanges remain archived, not current instructions.
            self.outcome_history_ids.clear()
            self.continuation_needed = True
        self.feedback_pending = bool(self.active_goal and self.active_goal.get("mode") and not self.active_goal.get("queue_policy_consumed"))
        self.publish(current_goal=self.active_goal, historical_goal=self.historical_goal)

    def persist(self, **changes):
        try:
            self.data.mkdir(parents=True, exist_ok=True)
            previous = json.loads(self.state_path.read_text(encoding="utf-8")) if self.state_path.exists() else {}
            temporary = self.state_path.with_suffix(".tmp")
            # A rename is atomic for readers, but does not flush buffered file
            # contents. Publish dispatch/stop state only after durable writeback.
            with temporary.open("w", encoding="utf-8") as stream:
                stream.write(encode({**previous, **changes}))
                stream.flush()
                os.fsync(stream.fileno())
            temporary.replace(self.state_path)
        except Exception as error:
            from .failure_diagnostics import capture_current
            capture_current(error, "host_state.persist")
            raise

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
                self.lookahead_used.discard(key)
                if key == self.lookahead_anchor and execution.get("phase") != "completed":
                    self.lookahead_invalidated = True
                    self.continuation_ready = True
                submitted = self.action_requests.pop(key, None)
                submitted_scope = self.action_scopes.pop(key, None)
                sampled = self.observation_requests.pop(key, None)
                if submitted and submitted_scope != self.game_scope:
                    foreign_execution_id = execution["id"]
                if submitted and submitted_scope == self.game_scope:
                    name, arguments, request_id, read_only = submitted
                    phase = execution.get("phase")
                    event = next((e for e in value.get("events", []) if (e.get("execution") or {}).get("id") == execution["id"]), {})
                    reference = {k: event[k] for k in ("run", "cursor", "ts") if k in event}
                    receipt = str((execution.get("evidence") or {}).get("receipt", ""))
                    observations = spatial_observations(receipt)
                    if read_only and phase == "completed" and sampled and (observations or receipt.strip()):
                        if len(self.observation_reads) >= 32:
                            self.observation_reads.pop(next(iter(self.observation_reads)))
                        self.observation_reads[sampled["key"]] = {**sampled, "at": time.monotonic(),
                            "observations": observations, **({"receipt": receipt} if not observations else {}),
                            "original_event": reference, "execution_id": execution["id"]}
                        # A requested answer can complete in milliseconds. Give
                        # the first two reads a prompt model handoff instead of
                        # adding the ordinary event throttle after each query.
                        # This is not body progress: keep failure/read ledgers,
                        # limit scan chains, and never interrupt other work.
                        self.spatial_handoffs += 1
                        if self.spatial_handoffs <= 2 and not (set(self.pending) - {key}):
                            self.continuation_ready = True
                    native_outcome = {"tool": name, "execution_id": execution["id"], "phase": phase,
                        "observation_only": read_only, "goal_verified": False,
                        "terminal": True, "goalCompleted": execution.get("goalCompleted"),
                        "step_outcomes": terminal_step_outcomes(execution, arguments),
                        "receipt": receipt if self.settings.context_mode == "full" else spatial_text(receipt),
                        "observations": observations, "original_event": reference}
                    self.native_outcomes.append(native_outcome if self.settings.context_mode == "full" else native_outcome_view(native_outcome))
                    if self.settings.context_mode == "full":
                        while len(self.native_outcomes) > 1 and len(encode(self.native_outcomes).encode("utf-8")) > self.settings.context_tokens:
                            self.native_outcomes.pop(outcome_eviction_index(self.native_outcomes))
                    else:
                        while len(self.native_outcomes) > 6:
                            self.native_outcomes.pop(outcome_eviction_index(self.native_outcomes))
                    # The public HUD keeps its small projection even when the private planner uses full evidence.
                    self.publish(native_outcomes=[native_outcome_view(row) for row in self.native_outcomes[-6:]])
                    effect_changed = not read_only and self.effect_recovery.record(
                        arguments, execution, self.game_scope, self.death_epoch, reference)
                    if effect_changed:
                        self.clear_read_activity()
                    if not read_only:
                        self.container_recovery.record(arguments, execution, self.game_scope, self.death_epoch, reference)
                    if not read_only and phase == "completed":
                        # A known body task has finished. Its next useful decision
                        # need not wait for the unrelated ordinary event throttle.
                        self.continuation_ready = True
                    if not read_only and phase in {"blocked", "rejected", "partial"}:
                        failure = self.record_tool_failure(name, arguments, {"text": receipt, "execution": execution}, request_id)
                        failure["native_execution"] = {k: execution[k] for k in ("kind", "id", "phase")}
                        failure["native_event"] = reference
                        failure["step_outcomes"] = terminal_step_outcomes(execution, arguments)
                        failure["failed_skills"] = list(dict.fromkeys(
                            arguments["steps"][row["step"] - 1]["skill"]
                            for row in failure["step_outcomes"]["samples"] if row["outcome"] == "fail"
                            and isinstance(arguments.get("steps"), list)
                            and isinstance(arguments["steps"][row["step"] - 1], dict)
                            and isinstance(arguments["steps"][row["step"] - 1].get("skill"), str)))[:2]
                        failure["next_step"] = ("The native task was accepted and has now ended with this actual outcome. "
                            "Earlier successful steps may have run. Use the latest world facts and this receipt to change the next feasible action; "
                            "do not resubmit the whole failed batch or repeat observations already answered. "
                            "Query mc_protocol(action=archive,run=original_event.run,after=original_event.cursor-1) for the full native event.")
                        self.retain_tool_failure(failure)
                    elif effect_changed and phase == "completed" and self.tool_failure and self.tool_failure.get("native_execution"):
                        # Native completion may mean only that a request was sent.
                        # Unknown, missing or unchanged effects do not retire an
                        # earlier body failure; the samples must attest change.
                        self.tool_failure = None
                        self.publish(tool_failure=None)
                self.pending.pop(key, None)
                self.action_owners.pop(key, None)
                self.publish(viewer_terminal={key: execution[key] for key in ("id", "terminal", "phase") if key in execution})
            else:
                # Late acceptance cannot resurrect an execution whose terminal
                # outcome is already retained for this game scope.
                if not any(row["execution_id"] == execution["id"] and row.get("terminal") is True
                           for row in self.native_outcomes):
                    self.pending[key] = execution
            self.persist(pending=list(self.pending.values()))
            # Facts/voice heartbeats can keep status.json fresh while its old
            # request-start pending projection remains accepted for minutes.
            # Publish only after the durable barrier, without waiting for LLM
            # completion or issuing a new native queue read.
            self.publish(pending=list(self.pending.values()))
        for event in value.get("events", []):
            if event.get("contextDelivery") == "archive-only" or event.get("meta", {}).get("staleEpoch"):
                continue
            body = body_event_view(event)
            if body and not any(row["id"] == body["id"] for row in self.body_events):
                self.body_events = [*self.body_events, body][-6:]
                self.publish(body_events=list(self.body_events))
            death = (event.get("meta") or {}).get("death")
            if isinstance(death, dict):
                episode = self.death_memory.record(event, self.game_facts, self.recent, self.native_outcomes,
                    [{"tool": item[0], "request_id": item[2], "execution_id": key[1], "observation_only": item[3]}
                     for key, item in self.action_requests.items() if self.action_scopes.get(key) == death.get("scope")])
                if episode:
                    self.death_epoch += 1  # Invalidates inference even if respawn arrives in the same poll.
                    self.death_recovery = episode
                    self.death_waiting = True
                    self.continuation_needed = True
                    self.synchronize_goals()
                    self.publish(death_episode=episode, game_identity=episode["scope"], body_death_episode_id=episode["id"])
            if self.death_memory.append_combat(event):
                current = self.death_memory.current_episode(self.game_scope, self.game_facts, pending=True)
                life = lifecycle(self.game_facts)
                if current and isinstance(life, dict) and life.get("episodeId") == current["id"]:
                    self.publish(death_episode=current)
        self.recent.extend(e for e in value.get("events", []) if e.get("contextDelivery") != "archive-only" and not e.get("meta", {}).get("staleEpoch")
                           and (foreign_execution_id is None or (e.get("execution") or {}).get("id") != foreign_execution_id))
        self.recent = retain_events(self.recent, byte_limit=self.settings.context_tokens if self.settings.context_mode == "full" else None)

    def clear_read_activity(self):
        self.read_activity.clear()
        self.spatial_handoffs = 0
        self.observation_reads.clear()
        self.read_answers.clear()
        self.read_recovery_tools.clear()
        self.publish(read_activity={}, read_recovery=None, action_recovery=None)

    def defer_answered_read(self, name):
        if name == "mc_do":
            # This port also owns real body actions. Reject the identical cached
            # observation above, but keep other mc_do plans available.
            return
        # Accumulate a bounded opportunity to choose other work. Clearing each
        # name after one request lets two answered queries alternate forever.
        self.read_recovery_tools[name] = {"facts": self.last_admission_facts, "scope": self.game_scope,
                                          "until": time.monotonic() + READ_RECOVERY_SECONDS}

    def deferred_read_tools(self, facts):
        fingerprint = admission_fingerprint(facts)
        for name, binding in list(self.read_recovery_tools.items()):
            if (binding["facts"] != fingerprint or binding["scope"] != self.game_scope
                    or time.monotonic() >= binding["until"]):
                self.read_recovery_tools.pop(name)
        # Running work may change inventory/queue without a published terminal;
        # its real status remains readable. Acceptance itself clears no history.
        return set(self.read_recovery_tools) if not self.pending else set()

    def current_answered_reads(self, facts):
        """Keep dated generic answers visible even if their exchange was evicted.

        This uses the same scope/state/expiry fence as read reuse. It does not
        query the body, assert freshness or restore a previous container window.
        Specific task lookups remain progressive, rather than filling the tail
        with every cached queue request.
        """
        if self.pending:
            return []
        fingerprint, now = admission_fingerprint(facts), time.monotonic()
        selected = {}
        for key, answer in self.read_answers.items():
            name, arguments = json.loads(key)
            if (arguments or answer["facts"] != fingerprint or answer["scope"] != self.game_scope
                    or now - answer["at"] >= READ_RECOVERY_SECONDS):
                continue
            selected[name] = {"tool": name, "arguments": arguments, "fresh": False,
                "answer": answer["answer"],
                **{field: answer[field] for field in ("received_at", "request_id", "turn_id")},
                "journal": "receipts.jsonl",
                "validity": "Dated answer retained under unchanged observed state, not a new server read. "
                            "It does not reopen a window, prove permissions or complete a goal."}
        return list(selected.values())

    async def recovery_reference(self):
        """Carry the failed skill's native documentation into the next decision.

        This is one cached read, not another inference, task, or guessed recipe.
        A known rejected lookup is cached; unknown dispatch retains its fence.
        """
        failure = self.tool_failure
        if not failure or not failure.get("native_execution") or not any(t["name"] == "mc_help" for t in self.bridge.tools):
            return
        references = []
        for skill in failure.get("failed_skills", [])[:2]:
            if skill not in self.skill_references:
                if len(self.skill_references) >= 16:
                    self.skill_references.pop(next(iter(self.skill_references)))
                result, _ = await self.dispatch("mc_help", {"skill": skill}, str(uuid.uuid4()))
                self.skill_references[skill] = None if result.get("failed") else fact_preview(result.get("text", ""), 1600)
            if self.skill_references[skill]:
                references.append({"tool": "mc_help", "arguments": {"skill": skill}, "text": self.skill_references[skill]})
        if references:
            failure["recovery"] = references
            failure["next_step"] += (" Native recovery contains the actual skill reference, not verified prerequisites. "
                "Check its inputs and the user's objective; do not keep trying different wrappers or fuels for an unverified recipe. "
                "A proposed stage may be reported blocked with evidence instead of repeated indefinitely.") if not failure.get("reference_loaded") else ""
            failure["reference_loaded"] = True

    def current_work(self):
        if self.active_goal and self.active_goal.get("mode") == "insert":
            # Earlier work resumes natively after a checkpoint insertion. It does
            # not prevent the inserted goal from observing/reporting its own result.
            return any(self.action_owners.get(key) in {None, self.active_goal["id"]} for key in self.pending)
        return bool(self.pending)

    def conversation_ready(self):
        # Native following may never publish a terminal. Its ownership must not
        # prevent a new conversation from receiving a bounded decision/read chain.
        return self.conversation_continuation or any(conversation_event(event) for event in self.recent)

    def command_interrupt_pending(self):
        if self.commands is None:
            return False
        ready = getattr(self.commands, 'interrupt_ready', self.commands.ready)
        return ready(allow_goal=self.active_goal is None and not self.pending)

    def lookahead_candidate(self):
        """One planning opportunity behind one known finite native body task.

        This stores no future action. Any selected successor goes through the
        existing native append queue and its ordinary validation/barriers.
        """
        if (len(self.pending) != 1 or self.inflight_request or self.feedback_pending
                or self.death_waiting or self.death_recovery or self.stop_requested()):
            return None
        key = next(iter(self.pending))
        submitted = self.action_requests.get(key)
        if (key in self.lookahead_used or not submitted or submitted[3]
                or self.action_scopes.get(key) != self.game_scope
                or self.pending[key].get("phase") not in {"accepted", "running"}):
            return None
        name, arguments, _, _ = submitted
        steps = arguments.get("steps")
        if (name != "mc_do" or not isinstance(steps, list) or not steps
                or any(not isinstance(step, dict) or step.get("skill") in {"follow", "wait"} for step in steps)):
            return None
        if self.active_goal and self.action_owners.get(key) != self.active_goal["id"]:
            return None
        return key

    def lookahead_tools(self, tools):
        selected = copy.deepcopy([tool for tool in tools
            if tool["function"]["name"] in IMMEDIATE_READ_TOOLS | {"mc_do", "mc_scout"}])
        for tool in selected:
            function = tool["function"]
            if function["name"] in {"mc_do", "mc_scout"}:
                function["parameters"].setdefault("properties", {})["queue"] = {
                    "type": "string", "enum": ["append"],
                    "description": "Planning ahead preserves the existing native task; append only."}
        return selected

    def model_timing(self):
        return {"at": datetime.now(timezone.utc).isoformat(), "request_started_at": self.model_started_at,
                "planning_mode": "native_lookahead" if self.lookahead_anchor else "ordinary",
                "native_pending": [key[1] for key in self.pending],
                **({"request_context": self.model_request_info} if getattr(self, "model_request_info", None) else {})}

    async def protocol(self, action, **arguments):
        result = json_content(await self.bridge.call("mc_protocol", {"protocol": PROTOCOL, "action": action, **arguments}))
        if action == "facts":
            self.observe_game_facts(result)
        return result

    async def events(self):
        # A timed-out optional waiter must not cancel/lose an admitted native
        # page (including renewal, archive and recovery facts). The coordinator
        # owns exactly one poll until its result or error has been observed.
        if self._event_poll is None:
            self._event_poll = asyncio.create_task(self._poll_events())
        task = self._event_poll
        try:
            result = await asyncio.shield(task)
        except asyncio.CancelledError:
            raise  # Keep ownership, even if completion raced waiter cancellation.
        except BaseException:
            self._event_poll = None
            self._deferred_event_drain = True
            raise
        else:
            self._event_poll = None
            self._deferred_event_drain = result[2]
            return result

    async def close_event_poll(self):
        task, self._event_poll = self._event_poll, None
        if task is None:
            if self._deferred_event_drain:
                self.persist(uncertain=True)  # hasMore attests unread native pages.
            return
        if not task.done() or task.cancelled():
            # Shutdown cannot certify an undrained authoritative page. Preserve
            # the restart fence before closing its native transport ownership.
            self.persist(uncertain=True)
            if not task.done():
                task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        if not task.cancelled():
            result = task.result()  # Propagate late native errors; never classify optional.
            if result[2]:
                self.persist(uncertain=True)  # Completed page still attests unread pages.

    async def join_deferred_events(self):
        """Join native ownership while admitting only explicit mailbox stops."""
        waiter = asyncio.create_task(self.events())
        try:
            while not waiter.done():
                await asyncio.wait({waiter}, timeout=0.05)
                await self.external_command(stop_only=True)
                if waiter.done():
                    break  # Observe completed native errors even alongside stop.
                if self.stop_requested():
                    return None
            return waiter.result()
        finally:
            if not waiter.done():
                waiter.cancel()  # The shielded poll remains owned by shutdown.
                await asyncio.sleep(0)
            if waiter.done() and not waiter.cancelled():
                waiter.result()  # Never hide a raced unknown or transport error.

    async def _poll_events(self):
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
        self.publish(native_run=self.event_run)
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
        if self.death_recovery and not page.get("hasMore", False):
            # Poll only native facts while recovering; cancellation receipts must
            # drain before one fresh decision can bypass the ordinary throttle.
            await self.protocol("facts")
            if not self.death_waiting and not self.pending and not self.inflight_request:
                self.death_recovery = None
                self.continuation_ready = True
                self.continuation_needed = True
                wake = True
        return wake, urgent, page.get("hasMore", False)

    async def archive_receipt(self, request_id, name, result, *, local_only=False):
        original = encode(result)
        with (self.data / "receipts.jsonl").open("a", encoding="utf-8") as output:
            output.write(encode({"requestId": request_id, "turnId": self.turn, "tool": name, "result": result}) + "\n")
        if not hasattr(self, "_read_once_answers") or self._read_once_turn != self.turn:
            self._read_once_turn, self._read_once_answers = self.turn, {}
        view = json.loads(original) if self.settings.context_mode == "full" else receipt_view(result)
        if self.settings.context_mode != "full" and not local_only and len(original.encode("utf-8")) > 6000:
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
        return encode(project_values(view) if self.settings.context_mode == "full" else view)

    async def original_page(self, arguments):
        offset, limit = arguments.get("offset", 0), arguments.get("limit", 1000)
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 1000:
            raise ValueError("Invalid original artifact page")
        from .host_recent import HANDLE_PREFIX
        if isinstance(arguments.get("handle"), str) and arguments["handle"].startswith(HANDLE_PREFIX):
            request = self.recent_request(self.current_host_context())
            if self.stop_requested() or not request:
                return {"text": encode({"status": "unavailable", "reason": "binding_unavailable"})}
            return {"text": encode(self.host_context_port.original_page(arguments["handle"], request, offset, limit))}
        raw = outcome(await self.bridge.call("mc_artifact", {"action": "get", "handle": arguments["handle"]}))
        if raw.get("failed"):
            return raw
        text = raw.get("text", "")
        end = min(len(text), offset + limit)
        return {"text": encode({"handle": arguments["handle"], "offset": offset, "text": text[offset:end],
                                "next_offset": end, "has_more": end < len(text), "total_characters": len(text)})}

    def current_host_context(self):
        from .host_context import validate_host_context
        try:
            value = self.host_context_provider(self.commands.intent_revision() if self.commands else 0)
            if value is None:
                return None
            if (not isinstance(value["stable"], dict) or not isinstance(value["dynamic"], dict)
                    or value["stable"].keys() - {"agent_name", "persona", "persona_source"}
                    or value["dynamic"].keys() - {"current_intent", "memories", "memories_selected"}):
                return None
            validated = validate_host_context({**value["stable"], **value["dynamic"]})
            return {"stable": {k: validated[k] for k in ("agent_name", "persona", "persona_source")},
                    "dynamic": {k: validated[k] for k in ("current_intent", "memories", "memories_selected")}}
        except Exception:
            return None  # Optional provider errors never expose private exception text.

    def recent_request(self, host):
        from .host_recent import binding
        try:
            life = lifecycle(self.game_facts)
            if self.game_facts.get("run") not in {None, self.event_run}:
                return None
            episode_id = life.get("episodeId") if isinstance(life, dict) else None
            if self.death_recovery and self.death_recovery.get("scope") == self.game_scope:
                episode_id = self.death_recovery["id"]
            request = {"identity": self.settings.identity, "actor": host["stable"]["agent_name"],
                       "session": self.runtime_session, "run": self.event_run, "scope": self.game_scope,
                       "intent_revision": self.commands.intent_revision() if self.commands else 0,
                       "death_episode_id": episode_id,
                       "as_of": time.time()}
            if self.settings.context_mode == "full":
                request["context_mode"] = "full"
            binding(request, request=True)
            return request
        except (ValueError, TypeError, KeyError):
            return None

    async def recent_for_round(self, host):
        """Bound optional work without recovering authoritative native failures."""
        import inspect

        from . import host_recent
        request = self.recent_request(host)
        self.publish(host_recent_request=request)
        if request is None:
            return host_recent.unavailable("binding_unavailable")
        epoch = self.death_epoch
        task, event_wait = None, None

        def interrupted():
            if self.stop_requested():
                return "stopped"
            if self.command_interrupt_pending():
                self.preempted = True
                return "feedback_changed"
            if epoch != self.death_epoch:
                self.preempted = True
                return "body_changed"
            return None

        def deferred(reason):
            self.preempted = True
            self._deferred_event_drain = True
            return host_recent.unavailable(reason)

        try:
            # Only provider invocation, result retrieval and schema validation
            # recover optional errors. Native event work is outside those scopes.
            try:
                value = self.recent_context_provider(request)
            except Exception:
                return host_recent.unavailable("provider_invalid")
            if inspect.isawaitable(value):
                task = asyncio.ensure_future(value)
                deadline = time.monotonic() + 0.5
                while True:
                    if not task.done():
                        await asyncio.wait({task}, timeout=max(0, min(0.05, deadline - time.monotonic())))
                    if reason := interrupted():
                        return host_recent.unavailable(reason)
                    if time.monotonic() >= deadline:
                        return host_recent.unavailable("provider_timeout")
                    event_wait = asyncio.create_task(self.events())
                    while not event_wait.done():
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            return deferred("native_events_pending")
                        await asyncio.wait({event_wait}, timeout=min(0.05, remaining))
                        # Completed native errors always propagate, even when a
                        # stop or deadline arrives in the same scheduling cycle.
                        if event_wait.done():
                            break
                        if reason := interrupted():
                            return deferred(reason)
                    wake, urgent, more = event_wait.result()
                    event_wait = None
                    self.deferred_wake |= wake
                    if urgent or (reason := interrupted()):
                        self.preempted = True
                        return host_recent.unavailable(reason or "body_changed")
                    if time.monotonic() >= deadline:
                        if more:
                            return deferred("native_events_pending")
                        return host_recent.unavailable("provider_timeout")
                    if task.done() and not more:
                        try:
                            value = task.result()
                        except Exception:
                            return host_recent.unavailable("provider_invalid")
                        break
            current = self.recent_request(self.current_host_context())
            if (self.stop_requested() or self.preempted or current is None or epoch != self.death_epoch
                    or host_recent.binding(current, request=True) != host_recent.binding(request, request=True)):
                self.preempted = True
                return host_recent.unavailable("binding_changed")
            if isinstance(value, dict) and value.get("available") is False:
                return host_recent.unavailable("snapshot_unavailable")
            try:
                value = host_recent.validate(value, current, time.time())
                return self.host_context_port.queryable_recent(value, current)
            except Exception:
                return host_recent.unavailable("provider_invalid")
        finally:
            try:
                if event_wait is not None:
                    if not event_wait.done():
                        self._deferred_event_drain = True
                        event_wait.cancel()  # Shield preserves the coordinator poll.
                        await asyncio.sleep(0)
                    if event_wait.done() and not event_wait.cancelled():
                        event_wait.result()  # Do not swallow a raced native error.
            finally:
                if task is not None:
                    if not task.done():
                        task.cancel()
                        await asyncio.sleep(0)
                    def consume_result(completed):
                        if not completed.cancelled():
                            completed.exception()
                    if task.done():
                        consume_result(task)
                    else:
                        task.add_done_callback(consume_result)
                current = self.recent_request(self.current_host_context())
                if (interrupted() or current is None
                        or host_recent.binding(current, request=True) != host_recent.binding(request, request=True)):
                    self.preempted = True

    async def decide_with_events(self, messages, tools, profile=None):
        death_epoch = self.death_epoch
        call=self.profile_decide(messages,tools,profile) if profile and self.profile_decide else self.decide(messages,tools)
        task = asyncio.create_task(asyncio.wait_for(call, self.settings.model_timeout_seconds))
        try:
            while True:
                done, _ = await asyncio.wait({task}, timeout=1)
                if self.stop_requested():
                    return self.cancelled_decision('stopped')
                if self.command_interrupt_pending():
                    # Close this decision turn before delivering external work;
                    # a stale model completion must not replace a newly inserted job.
                    self.preempted = True
                    return self.cancelled_decision('explicit_command')
                wake, urgent, more = await self.events()
                self.deferred_wake |= wake
                if urgent or death_epoch != self.death_epoch or self.lookahead_invalidated:
                    self.preempted = True
                    reason = 'anchor_failed' if self.lookahead_invalidated else 'death' if death_epoch != self.death_epoch else 'native_preempt'
                    return self.cancelled_decision(reason)
                if more:
                    continue  # A completed inference cannot outrun a queued death event page.
                if done:
                    try:
                        result=await task
                    except TimeoutError:
                        # Only the model task is covered here. Native polling
                        # errors and explicit cancellation retain their own
                        # failure/preemption semantics; no action is replayed.
                        raise PlannerDeadlineError() from None
                    if profile and not self.profile_decide and isinstance(result,dict):
                        result.setdefault('model_status',{})['decision_profile']=profile_view(profile,parameters_applied=False,fallback='planner_profile_port_unavailable',budget_applied=False)
                    return result
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    def cancelled_decision(self, reason):
        record = {**self.model_timing(), 'turnId': self.turn, 'controller_cancelled': reason,
                  'dispatched': False, 'scope': 'this_inference_only'}
        with (self.data / 'decisions.jsonl').open('a', encoding='utf-8') as output:
            output.write(encode(record) + '\n')
        self.publish(planner_activity={**record, 'phase': 'cancelled'})
        return None

    async def dispatch(self, name, arguments, request_id, *, attribution=None):
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
            # A stale/local report has not mutated the goal or native body.
            # Give its exact rejection back to the planner; do not turn pending
            # work into a fatal runtime error or an unknown native dispatch.
            result = {"protocol": PROTOCOL, "failed": True, "execution": None,
                      "dispatched": False, "origin": "controller_validation", "code": "goal_report_not_ready",
                      "text": "goal_report requires an active submitted goal, no pending native work for that goal, and observed evidence. No goal was completed or changed. Wait for the native terminal receipt, then reassess; current work continues."}
            return result, await self.archive_receipt(request_id, name, result)
        reported_facts = None
        if name == "goal_report":
            target = self.active_goal["id"]
            reported_facts = await self.protocol("facts")
            if not self.active_goal or self.active_goal["id"] != target or self.death_waiting:
                result = {"protocol": PROTOCOL, "failed": True, "execution": None, "dispatched": False,
                          "text": "Fresh body facts invalidated the reported stage. No goal was completed; reassess against current intent and original receipts."}
                return result, await self.archive_receipt(request_id, name, result)
        documentation = None
        shared_help = any(tool["name"] == "mc_tool_help" for tool in self.bridge.tools)
        if name == "mc_tool_help" and shared_help and arguments.get("name") in HIDDEN_TOOLS:
            result = {"protocol": PROTOCOL, "failed": True, "execution": None, "dispatched": False,
                      "text": "That transport/control tool belongs to the runtime coordinator; it is not a planner capability."}
            return result, await self.archive_receipt(request_id, name, result)
        if name == "mc_tool_help" and not shared_help:
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
                      "observed_facts": reported_facts, "original_receipts": "receipts.jsonl"}
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
        elif name == "mc_tool_help" and not shared_help:
            raw = {"structuredContent": {"protocol": PROTOCOL, **documentation}}
        elif name == "death_review":
            try:
                detail = self.death_memory.execute(self.game_scope, arguments)
                raw = {"structuredContent": {"protocol": PROTOCOL, "text": encode(detail)}}
            except ValueError as error:
                raw = {"structuredContent": {"protocol": PROTOCOL, "failed": True, "text": str(error)}}
        else:
            raw = await self.bridge.call(name, arguments, request_id=request_id, turn_id=self.turn,
                                        **({"attribution": attribution} if attribution is not None else {}))
        result = outcome(raw)
        if self.settings.vision_enabled:
            frame = latest_png(raw, name)
            if frame:
                self.frame = frame
                self.publish(perception={k: v for k, v in frame.items() if k not in {"url", "received_at"}})
        from .host_recent import HANDLE_PREFIX
        host_original = name == "mc_original" and isinstance(arguments.get("handle"), str) and arguments["handle"].startswith(HANDLE_PREFIX)
        compact = await self.archive_receipt(request_id, name, result, local_only=host_original)
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
                self.observation_requests.pop(old, None)
            self.action_requests[key] = (name, json.loads(encode(arguments)), request_id, observation_call(name, arguments))
            self.action_scopes[key] = self.game_scope
            spatial_key = spatial_read_key(name, arguments)
            if spatial_key is not None:
                self.observation_requests[key] = {"key": spatial_key, "facts": self.last_admission_facts,
                                                  "scope": self.game_scope}
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

    async def external_command(self, *, stop_only=False):
        command = (self.commands.claim(stop_only=True) if stop_only else
                   self.commands.claim(allow_goal=self.active_goal is None and not self.pending)) if self.commands else None
        if not command:
            return False
        if command["kind"] == "stop":
            self.operator_stop = True
            self.commands.stop_queued()
            self.commands.finish(command["id"], {"stop_requested": True, "disconnect_confirmed": False})
            return True
        if command["kind"] in {"goal", "feedback"} and command["payload"].get("origin") == "host_review":
            # Recheck at actual mailbox admission, not just host acceptance.
            await self.protocol("facts")
            if inapplicable_reason(command["payload"], self.stage_baseline()):
                self.commands.retire_host_admission(command["id"])
                self.synchronize_goals()
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
                self.outcome_history_ids.clear()
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
                self.outcome_history_ids.clear()
                self.last_decision = 0
                self.publish(current_goal=self.active_goal, unactioned_replies=0, planner_retry_seconds=0)
            return True
        self.turn = str(uuid.uuid4())
        await self.protocol("begin_turn", id=self.turn)
        try:
            result, _ = await self.dispatch("mc_do", command["payload"], command["id"],
                                           attribution={"controller": "human", "decisionId": command["id"]})
            self.publish(viewer_action=tool_receipt("mc_do", command["payload"], result))
            self.commands.finish(command["id"], result)
        finally:
            if not self.inflight_request:
                await self.protocol("end_turn", id=self.turn)
                self.turn = None
        return True

    async def wait_for_native_reconnect(self, status):
        """Wait for an already-active body retry; never reconnect or replay work."""
        self.frame = None
        while not online(status):
            await self.external_command(stop_only=True)
            if self.stop_requested():
                return False
            connection = status.get("connection") or {}
            if (status.get("phase") != "started" or connection.get("ready") is not False
                    or connection.get("phase") not in {"connecting", "retrying"}):
                raise RuntimeError("connection_lost: native retry is not active; inspect authentication and connection logs")
            self.publish(phase="reconnecting", game_connected=False, autonomy_running=False,
                         connection_wait={"ready": False, "phase": connection["phase"]})
            # Continue owning native event pages and exact terminal receipts,
            # including partial work cancelled by the connection loss.
            _, _, more = await self.events()
            await asyncio.sleep(0 if more else 1)
            status = json_content(await self.bridge.call("mc_connection", {"action": "status"}))
        if self.stop_requested():
            return False
        self.read_answers.clear()
        self.last_facts = None
        await self.observe_queue()  # Fresh body facts before another model round.
        self.publish(phase="running", game_connected=True, autonomy_running=self.decide is not None,
                     connection_wait=None)
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
            raise ModelCallRejected("Unavailable Minecraft tool. Only call advertised functions; use mc_tool_help and the advertised mc_invoke(name,arguments) entry when a native name is not exposed directly.")
        try:
            arguments = json.loads(function.get("arguments", ""))
        except json.JSONDecodeError as error:
            raw = function["arguments"]
            excerpt = raw[max(0, error.pos - 80):error.pos + 100]
            raise ToolJSONRejected(
                f"Tool arguments for {name} must be one complete JSON object: {error.msg} "
                f"at line {error.lineno}, column {error.colno}, offset {error.pos}. "
                "Write a new valid JSON object using the advertised field names and values; "
                "no arguments were repaired or dispatched. Do not copy malformed historical output.",
                {"tool": name, "error": error.msg, "line": error.lineno, "column": error.colno,
                 "offset": error.pos, "rejected_raw_excerpt": excerpt},
            ) from None
        except (ValueError, TypeError):
            raise ModelCallRejected("Tool arguments must be one complete JSON object.") from None
        if not isinstance(arguments, dict):
            raise ModelCallRejected("Tool arguments must be a JSON object.")
        if name == "mc_do" and "_spoken_text" in arguments:
            declaration = next(t["function"] for t in tools if t["function"]["name"] == name)
            if "_spoken_text" not in declaration.get("parameters", {}).get("properties", {}):
                raise ModelCallRejected("Host speech was not advertised for this request.")
            arguments.pop("_spoken_text")  # Host metadata never reaches the native body/schema.
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
        if self.lookahead_anchor and (name not in IMMEDIATE_READ_TOOLS | {"mc_do", "mc_scout"}
                or name in {"mc_do", "mc_scout"} and arguments.get("queue", "append") != "append"):
            raise ModelCallRejected("Planning ahead may only read or append to the native queue; running work cannot be stopped or inserted into.")
        if self.feedback_pending:
            tags = next((t.get("_meta", {}).get(PROTOCOL, {}).get("tags", []) for t in self.bridge.tools if t["name"] == name), [])
            effects = {"act", "write", "speak"}.intersection(tags)
            # mc_messages shares a read/write declaration because review marks
            # consideration. Its validated list/search/read forms do not write
            # or act; new user goals often need these before choosing any work.
            message_query = (name == "mc_messages" and "read" in tags
                             and arguments.get("action", "list") in {"list", "search", "read"})
            query = empty_catalogue_query(name, arguments) or message_query
            if name != "mc_do" and effects and not (effects == {"write"} and query):
                raise ModelCallRejected("Pending feedback must submit its body plan through mc_do. "
                    "Read-only catalogue queries mc_blueprint({}) and mc_map({}) are allowed; "
                    "mc_messages list/search/read can inspect dated observations before planning. "
                    "metadata writes remain blocked until the body plan is accepted.")
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
        if self._event_poll is not None or self._deferred_event_drain:
            self.preempted = True
            result = {"failed": True, "dispatched": False, "origin": "controller_boundary",
                      "text": "Authoritative native events must drain before another tool dispatch."}
            return result, encode(result), True
        if self.death_waiting or (self.turn and self.turn_death_epoch != self.death_epoch):
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
        repeat = self.effect_recovery.repeated(arguments, self.game_facts, self.game_scope, self.death_epoch) if name == "mc_do" and not self.pending and not queue_error else None
        if not repeat and name == "mc_do" and not self.pending and not queue_error:
            repeat = self.container_recovery.repeated(arguments, self.game_facts, self.game_scope, self.death_epoch)
        if repeat and not observation_call(name, arguments):
            container_failure = repeat.get("kind") == "failed_container_take"
            code = "repeated_container_failure" if container_failure else "repeated_no_effect"
            self.planner_notice = (("This withdrawal from the same explicitly opened container already failed twice without inventory change. "
                "Walking, reopening it, new narration or a different later batch do not resolve that failure. "
                "The entire proposed batch was NOT dispatched. Use the dated native evidence to correct the item/container, "
                "obtain prerequisites through real work, query a specific missing fact, choose different work, or wait for changed conditions. "
                "The refusal expires within 120 seconds and does not establish current contents, permissions or goal success.") if container_failure else
                ("The same native plan already ended twice without any measured change, and position/inventory/dimension are still unchanged. "
                "It was NOT dispatched again. Use the original terminal evidence and native skill help to correct the prerequisites, choose different useful work, "
                "or report this proposed stage blocked. This dated client-visible evidence does not prove permissions or goal success."))
            self.continuation_needed = True
            delay = max(30, self.settings.min_decision_seconds)
            self.planner_retry_at = time.monotonic() + delay
            self.publish(action_recovery=repeat, planner_error=code, planner_retry_seconds=delay)
            result = {"failed": True, "dispatched": False, "origin": "controller_validation", "code": code,
                      "text": self.planner_notice, "previous_outcome": repeat}
            return result, await self.archive_receipt(request_id, name, result), True
        read_key = json.dumps([name, arguments], sort_keys=True, ensure_ascii=False)
        answer = self.read_answers.get(read_key) if name in REUSABLE_IMMEDIATE_READS else None
        if (answer and not self.pending and self.last_admission_facts is not None
                and answer["facts"] == self.last_admission_facts and answer["scope"] == self.game_scope
                and time.monotonic() - answer["at"] < READ_RECOVERY_SECONDS):
            self.defer_answered_read(name)
            result = {"failed": True, "dispatched": False, "origin": "controller_validation",
                "code": "read_already_answered",
                "text": "This exact read was already answered with unchanged observed state. It was NOT dispatched again. The dated answer and original handles remain below. Answered tools yield for a bounded recovery window (at most 300 seconds), restored by changed facts or connection. Use the retained answers to choose useful native work, query a specific unresolved fact through available tools, or wait for a stated condition. Repeating the query cannot open a container or change the inventory.",
                "previous_answer": {"fresh": False, "answer": answer["answer"],
                    **{key: answer[key] for key in ("received_at", "request_id", "turn_id")},
                    "journal": "receipts.jsonl"}}
            self.planner_notice = result["text"]
            self.continuation_needed = True
            self.publish(read_recovery={"code": result["code"], "tool": name,
                "read_activity": dict(self.read_activity), "action_progress_verified": False})
            return result, await self.archive_receipt(request_id, name, result), True
        spatial_key = spatial_read_key(name, arguments)
        previous = self.observation_reads.get(spatial_key) if spatial_key else None
        if (previous and not self.pending and self.last_admission_facts is not None
                and previous["facts"] == self.last_admission_facts and previous["scope"] == self.game_scope
                and time.monotonic() - previous["at"] < READ_RECOVERY_SECONDS):
            # This is a dated read reference, not fresh world evidence or a new
            # native task. Never replay actions, invent a terminal ID or cache an
            # acceptance. Different geometry, changed facts and expiry re-read.
            result = {"failed": True, "dispatched": False, "origin": "controller_validation",
                "code": "observation_already_answered",
                "text": "This exact spatial batch already completed at the same observed place/state. It was NOT queued again. Use its measured results below. Unknown means occluded/unloaded, not empty or safe. Repeating unchanged scans is not progress: choose a different useful viewpoint/method, one feasible local action, or report a genuinely blocked stage. These are previous samples, not a fresh scan.",
                "previous_observation": {"fresh": False, "observations": previous["observations"],
                    **({"receipt": previous["receipt"]} if "receipt" in previous else {}),
                    "original_event": previous["original_event"], "execution_id": previous["execution_id"],
                    "query": "mc_protocol(action=archive,run=original_event.run,after=original_event.cursor-1)"}}
            self.planner_notice = result["text"]
            self.defer_answered_read(name)
            self.continuation_needed = True
            self.publish(read_recovery={"code": result["code"], "read_activity": dict(self.read_activity),
                "original_event": previous["original_event"], "action_progress_verified": False})
            return result, await self.archive_receipt(request_id, name, result), True
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
            result, compact = await self.dispatch(name, arguments, request_id,
                attribution={"controller": "system2", **({"decisionId": self.turn} if self.turn else {})})
        self.publish(viewer_action=tool_receipt(name, arguments, result))
        read_only = observation_call(name, arguments)
        if not result.get("failed"):
            if name in REUSABLE_IMMEDIATE_READS and not result.get("execution"):
                if len(self.read_answers) >= 32:
                    self.read_answers.pop(next(iter(self.read_answers)))
                self.read_answers[read_key] = {"facts": self.last_admission_facts, "scope": self.game_scope,
                    "at": time.monotonic(), "answer": json.loads(compact),
                    "received_at": datetime.now(timezone.utc).isoformat(), "request_id": request_id, "turn_id": self.turn}
            if read_only:
                self.read_activity[name] = min(999, self.read_activity.get(name, 0) + 1)
            elif result.get("execution") and (name == "mc_do" or "act" in next(
                    (t.get("_meta", {}).get(PROTOCOL, {}).get("tags", []) for t in self.bridge.tools if t["name"] == name), [])):
                # Acceptance owns a task, not physical progress. Only validated
                # terminal effect readbacks above may reset the read history.
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
        if (not read_only and not result.get("failed")
                and execution.get("phase") in {"accepted", "running", "completed"}):
            self.conversation_continuation = False  # Model chose a real native plan; no automatic cancellation.
        queued = bool(execution and execution.get("terminal") is not True)
        boundary = bool(queued or control.get("endTurnRequested") or result.get("endsTurn")
                        or (self.current_work() and not self.feedback_pending
                            and not self.conversation_continuation and not self.lookahead_anchor))
        return result, compact, boundary

    def reject_model_call(self, error, response=None, input_scene=None):
        # Validation is not an uncertain action. Keep the exact response above,
        # let the next bounded decision correct it, and leave the body connected.
        self.invalid_tool_calls += 1
        self.planner_notice = "No tool was dispatched. " + str(error)
        calls = response.get("tool_calls") if isinstance(response, dict) else None
        if isinstance(error, ToolJSONRejected):
            # A rejected argument string is not a valid assistant tool example.
            # Preserve it in the original journal, but project ordinary user
            # validation feedback with no orphaned or malformed tool exchange.
            self.groups.append([*([input_scene] if input_scene else []), {"role": "user", "content": encode({
                "rejected_model_call": {"dispatched": False, "error": str(error),
                    "original": {"journal": "decisions.jsonl", "turn_id": self.turn}}})}])
            self.retain_history()
        # Complete wire envelopes can carry their exact rejection into the next
        # request. Never serialize malformed IDs/functions as model tool history.
        if (not isinstance(error, ToolJSONRejected) and isinstance(calls, list) and 1 <= len(calls) <= 8
                and all(isinstance(call, dict) and call.get("type", "function") == "function"
                        and isinstance(call.get("id"), str) and call["id"]
                        and isinstance(call.get("function"), dict)
                        and isinstance(call["function"].get("name"), str) and call["function"]["name"]
                        and isinstance(call["function"].get("arguments"), str) for call in calls)
                and len({call["id"] for call in calls}) == len(calls)):
            failure = encode({"failed": True, "dispatched": False, "origin": "controller_validation",
                              "text": self.planner_notice})
            if len(calls) == 1:
                try:
                    arguments = json.loads(calls[0]["function"]["arguments"])
                except ValueError:
                    arguments = None
                if isinstance(arguments, dict):
                    correction = failure_context(self.bridge.tools, calls[0]["function"]["name"], arguments, {"text": str(error)})
                    correction["original_receipts"] = "decisions.jsonl"
                    failure = encode({**json.loads(failure), "correction": correction})
            self.groups.append([*([input_scene] if input_scene else []), assistant_history(response), *[
                {"role": "tool", "tool_call_id": call["id"], "content": failure} for call in calls]])
            # Coalesce before the eight-group cap so exact validation loops do
            # not evict distinct outcomes. Original responses remain journaled.
            if self.settings.context_mode != "full":
                self.groups, _ = coalesce_rejected(self.groups)
            self.retain_history()
        with (self.data / "decisions.jsonl").open("a", encoding="utf-8") as output:
            output.write(encode({**self.model_timing(), "turnId": self.turn, "rejected": str(error), "dispatched": False,
                **({"json_diagnostic": error.diagnostic} if isinstance(error, ToolJSONRejected) else {})}) + "\n")
        immediate = (isinstance(error, ToolJSONRejected) and self.invalid_tool_calls == 1
                     and not self.pending and self.inflight_request is None and not self.stop_requested())
        delay = 0 if immediate else min(60, max(1, self.settings.min_decision_seconds) * 2 ** min(6, self.invalid_tool_calls - 1))
        self.planner_retry_at = time.monotonic() + delay
        self.continuation_ready = immediate
        self.continuation_needed = True
        self.publish(planner_error="invalid_model_tool_call", invalid_tool_calls=self.invalid_tool_calls,
                     planner_retry_seconds=delay, planner_correction={"kind": "json_syntax" if isinstance(error, ToolJSONRejected) else "validation",
                         "attempt": self.invalid_tool_calls, "immediate": immediate, "dispatched": False})

    def retain_history(self):
        if self.settings.context_mode != "full":
            self.groups = self.groups[-8:]
        else:
            # Use the selected model's units here too. A byte cap prematurely
            # shifts an otherwise reusable history prefix in a token window.
            # Assembly still accounts for rules/tools, facts and output reserve.
            while len(self.groups) > 1:
                from .scene_history import project_messages
                retained, _ = project_messages([m for group in self.groups for m in group])
                try:
                    if self.context_counter is None:
                        raise CounterUnavailable("not_configured")
                    size = count_input(self.context_counter, retained, [])
                except CounterUnavailable:
                    size = len(encode(retained).encode("utf-8"))
                if size <= self.settings.context_tokens:
                    break
                self.groups.pop(0)

    def synchronize_host_history(self, context):
        if self.settings.context_mode != 'full':
            return
        scope = encode(context.get('stable', {}) if context else {})
        previous = getattr(self, '_host_history_scope', None)
        if previous is not None and previous != scope:
            # Raw selected host memory now belongs to input history. Never
            # replay it across a persona/source change. Native ledgers and
            # pending work remain authoritative and are not touched here.
            self.groups.clear()
            self.outcome_history_ids.clear()
        self._host_history_scope = scope

    def freeze_native_history(self):
        """Append each newly observed terminal once, between complete exchanges."""
        if self.settings.context_mode != "full":
            return
        rows=[(outcome_id(row),row) for row in self.native_outcomes]
        self.outcome_history_ids.intersection_update(key for key,_ in rows if key)
        for key,row in rows:
            if key and key not in self.outcome_history_ids:
                self.groups.append([outcome_message(row)])
                self.outcome_history_ids.add(key)
        self.retain_history()

    async def turn_once(self, goal, prefix, tools):
        if self._event_poll is not None or self._deferred_event_drain:
            self.preempted = True
            self.continuation_needed = True
            return
        self.preempted = False
        self.deferred_wake = False
        self.continuation_needed = False
        self.continuation_ready = False  # Consume one meaningful handoff, never a polling loop.
        self.turn = str(uuid.uuid4())
        self.turn_death_epoch = self.death_epoch
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
                planning_goal = self.goal_prompt(goal)
                # Keep answered queries deferred across alternating read attempts,
                # scoped to current evidence with bounded expiry. The model still
                # chooses its own work; originals and unresolved tools remain.
                excluded = self.deferred_read_tools(facts)
                round_tools = [tool for tool in tools if tool["function"]["name"] not in excluded]
                if self.lookahead_anchor:
                    round_tools = self.lookahead_tools(round_tools)
                notice = self.planner_notice
                if self.lookahead_anchor:
                    notice = (notice + "\n" if notice else "") + (
                        f"Planning ahead of still-owned native execution {self.lookahead_anchor[1]}. "
                        "It is not finished or verified successful. Keep it running. You may append one small "
                        "independent continuation using observed facts, or wait for its terminal if prerequisites "
                        "depend on an unknown outcome. Do not repeat, cancel or replace existing work to fill time.")
                state = focus_state(planning_goal, facts, self.pending)
                if round_index == 0:
                    focus = await self.fast_policy.choose(state)
                    if focus["source"] != "rules":
                        fresh = await self.protocol("facts")
                        if fact_fingerprint(fresh) != fact_fingerprint(facts):
                            focus = {"source": "rules", "choice": rule_focus(focus_state(self.goal_prompt(goal), fresh, self.pending)),
                                     "reason": "state_changed", "advisory_only": True}
                        facts = fresh
                        planning_goal = self.goal_prompt(goal)
                    self.publish(fast_focus=focus)
                else:
                    focus = {"source": "rules", "choice": rule_focus(state), "advisory_only": True}
                self.last_facts = fact_fingerprint(facts)
                self.last_admission_facts = admission_fingerprint(facts)
                await self.recovery_reference()
                consumed = tuple(self.recent)
                self.deferred_wake = False
                frame = self.frame
                self.frame = None
                _, image_ready = attach_frame([{"role": "user", "content": ""}], frame)
                reserve = IMAGE_RESERVE if image_ready else 0
                from .host_context import metadata as host_context_metadata
                host_context = self.current_host_context()
                self.synchronize_host_history(host_context)
                self.publish(host_context=host_context_metadata(host_context))
                recent_context = await self.recent_for_round(host_context)
                from .narration import (
                    GUIDANCE,
                    NarrationPort,
                    response_line,
                    tool_contract,
                )
                narration = NarrationPort(self.data)
                narration_request = self.recent_request(host_context)
                narration_binding = ({k: v for k, v in narration_request.items() if k != "as_of"}
                                     if narration_request else None)
                try:
                    narration_enabled = bool(narration_binding and narration.consumer(narration_binding))
                except (OSError, sqlite3.Error):
                    narration_enabled = False
                round_prefix = prefix + (GUIDANCE if narration_enabled else "")
                if narration_enabled:
                    round_tools = tool_contract(round_tools)
                # A temporary admission restriction must not rewrite a provider's
                # leading tool-schema block and invalidate the whole cached prompt.
                # Keep validation on round_tools; declaration is not permission.
                wire_tools = round_tools
                current_tool_policy = None
                if self.settings.context_mode == "full":
                    wire_tools = tool_contract(tools) if narration_enabled else tools
                    current_tool_policy = {
                        "allowed_tools": [tool["function"]["name"] for tool in round_tools],
                        "native_queue": "append_only" if self.lookahead_anchor else "normal",
                    }
                if self.stop_requested() or self.preempted or self.turn_death_epoch != self.death_epoch or self._event_poll is not None or self._deferred_event_drain:
                    return
                self.freeze_native_history()
                try:
                    messages, budget = assemble(round_prefix, wire_tools, planning_goal, facts, consumed, self.groups,
                        context_tokens=self.settings.context_tokens - reserve, reserved_output=self.settings.max_output_tokens,
                        context_mode=self.settings.context_mode, context_history_headroom_tokens=self.settings.context_history_headroom_tokens,
                        planner_notice=notice, fast_focus=focus, tool_failure=self.tool_failure, read_activity=self.read_activity, answered_reads=self.current_answered_reads(facts), native_outcomes=self.native_outcomes,
                        context_counter=self.context_counter, host_context=host_context, recent_context=recent_context, death_memory=self.death_memory.context(self.game_scope, self.game_facts, self.active_goal), current_tool_policy=current_tool_policy)
                except ValueError:
                    if not reserve:
                        raise
                    reserve = 0
                    messages, budget = assemble(round_prefix, wire_tools, planning_goal, facts, consumed, self.groups,
                        context_tokens=self.settings.context_tokens, reserved_output=self.settings.max_output_tokens,
                        context_mode=self.settings.context_mode, context_history_headroom_tokens=self.settings.context_history_headroom_tokens,
                        planner_notice=notice, fast_focus=focus, tool_failure=self.tool_failure, read_activity=self.read_activity, answered_reads=self.current_answered_reads(facts), native_outcomes=self.native_outcomes,
                        context_counter=self.context_counter, host_context=host_context, recent_context=recent_context, death_memory=self.death_memory.context(self.game_scope, self.game_facts, self.active_goal), current_tool_policy=current_tool_policy)
                if reserve:
                    messages, _ = attach_frame(messages, frame)
                from .scene_history import capture_scene
                input_scene = capture_scene(messages) if self.settings.context_mode == "full" else None
                budget.update(image_reserve=reserve, total=budget["total"] + reserve, limit=self.settings.context_tokens)
                if self.settings.context_mode == "full":
                    # Do not resurrect the old prefix evicted by this request.
                    # Original journals/handles remain intact, as do all current
                    # body facts, terminal outcomes and pending-event fences.
                    history = budget["history"]
                    if history["available"] == len(self.groups) and history["evicted"]:
                        self.groups = self.groups[history["evicted"]:]
                self.publish(context=budget)
                # Non-content request evidence survives completion/cancellation/
                # timeout, instead of being overwritten by the next live status.
                self.model_request_info = {
                    "input": budget["input"], "counter": budget["counter"],
                    "units": budget["units"], "limit": budget["limit"],
                    "history": budget.get("history"), "layout": budget.get("layout"),
                }
                self.conversation_continuation |= any(
                    conversation_event(consumed[index]) for index in budget["event_delivery"]["included_indices"])
                try:
                    self.model_started_at = datetime.now(timezone.utc).isoformat()
                    self.publish(planner_activity={"phase": "model", **self.model_timing()})
                    death_context=self.death_memory.context(self.game_scope, self.game_facts, self.active_goal) if self.settings.decision_policy.enabled else None
                    episode_id=death_context.get('latest_episode',{}).get('id') if death_context else None
                    profile=self.settings.decision_policy.select(focus=focus.get('choice'),failure=bool(self.tool_failure or self.planner_notice),feedback=self.feedback_pending,
                        death=bool(episode_id and episode_id!=self.profile_death_id))
                    response = await self.decide_with_events(messages, wire_tools, profile)
                except (PlannerResponseError, PlannerUnavailableError, PlannerRequestRejectedError) as error:
                    with (self.data / "decisions.jsonl").open("a", encoding="utf-8") as output:
                        output.write(encode({**self.model_timing(), "turnId": self.turn, "rejected": error.diagnostic, "dispatched": False,
                                             "context_delivery": budget["event_delivery"]}) + "\n")
                    self.planner_failures += 1
                    if isinstance(error, PlannerRequestRejectedError):
                        self.planner_notice = "The provider rejected the planning request before any dispatch. Check the configured model/provider compatibility. Native work and reflexes remain independent; do not replay pending actions."
                    elif isinstance(error, PlannerUnavailableError):
                        self.planner_notice = "The previous planning request was temporarily unavailable. No tool from it was dispatched. Use the latest facts and original receipts to continue; do not assume an action ran or replay pending native work."
                    else:
                        self.planner_notice = "The previous model response was invalid or incomplete. No tool from it was dispatched. Return one concise, complete tool call or a short reply; split large plans into small batches."
                    self.publish(planner_error=str(error), planner_failures=self.planner_failures,
                                 planner_diagnostic=error.diagnostic if isinstance(error, PlannerRequestRejectedError) else None)
                    # This response has not dispatched a tool. Keep the native
                    # connection/reflexes alive while the planner backs off;
                    # a failed inference is not an unknown body outcome.
                    delay = min(300, max(5, self.settings.min_decision_seconds) * 2 ** min(self.planner_failures - 1, 6))
                    if isinstance(error, PlannerRequestRejectedError):
                        delay = 300  # Configuration errors must not cause an inference/reconnect loop.
                    self.planner_retry_at = time.monotonic() + delay
                    self.publish(planner_retry_seconds=delay)
                    self.continuation_needed = True
                    return
                if self.stop_requested() or response is None or self.turn_death_epoch != self.death_epoch:
                    return
                repetitive = repeated_plain_reply(response)
                if repetitive:
                    # Preserve the original response and fresh events, but never
                    # feed a runaway phrase back as ordinary history or speech.
                    with (self.data / "decisions.jsonl").open("a", encoding="utf-8") as output:
                        output.write(encode({**self.model_timing(), "turnId": self.turn, "response": response, "rejected": repetitive,
                                             "dispatched": False, "context_delivery": budget["event_delivery"]}) + "\n")
                    self.planner_failures += 1
                    delay = min(300, max(5, self.settings.idle_decision_seconds, self.settings.min_decision_seconds)
                                * 2 ** min(self.planner_failures - 1, 6))
                    self.planner_retry_at = time.monotonic() + delay
                    self.continuation_needed = True
                    self.planner_notice = (
                        "The previous response was rejected as repetitive_model_reply: a long repeated phrase "
                        "without a structured tool call. It dispatched no action or speech. Do not copy that "
                        "phrase. Use the retained fresh facts and receipts for one complete tool call or a "
                        "concise non-repetitive reply explaining a real waiting condition. Existing native "
                        "work remains independent; never replay an unknown or pending action."
                    )
                    self.publish(planner_error=repetitive["code"], planner_diagnostic=repetitive,
                                 planner_failures=self.planner_failures, planner_retry_seconds=delay,
                                 last_message="", narration={"offered": False, "reason": repetitive["code"]})
                    if response.get("model_status"):
                        self.publish(model_status=response["model_status"])
                    return
                if profile and profile['reason']=='death_review':
                    self.profile_death_id=episode_id
                self.planner_failures = 0
                self.planner_retry_at = 0.0
                self.planner_notice = None
                self.publish(planner_error=None, planner_diagnostic=None, planner_failures=0, planner_retry_seconds=0, planner_correction=None)
                model_status = response.get("model_status", {})
                if model_status:
                    self.publish(model_status=model_status, autonomy_running=model_status.get("route") != "unavailable")
                if model_status.get("route") == "unavailable":
                    self.planner_retry_at = time.monotonic() + 60
                    self.continuation_needed = True
                # Retain the exact model result before validation, including rejected
                # calls. Runtime diagnostics must not require replaying a game action.
                with (self.data / "decisions.jsonl").open("a", encoding="utf-8") as output:
                    output.write(encode({**self.model_timing(), "turnId": self.turn, "response": response,
                                         "context_delivery": budget["event_delivery"]}) + "\n")
                # Events arriving during inference belong to the next request.
                consumed_ids = {id(consumed[index]) for index in budget["event_delivery"]["included_indices"]}
                self.recent = [event for event in self.recent if id(event) not in consumed_ids]
                calls = response.get("tool_calls") or []
                self.publish(last_message=(response.get("content") or "")[:1200], viewer_decision_at=datetime.now(timezone.utc).isoformat())
                def offer_narration():
                    if narration_enabled and not self.stop_requested() and not self.preempted:
                        try:
                            self.publish(narration=narration.offer(response_line(response), narration_binding))
                        except (OSError, sqlite3.Error):
                            self.publish(narration={"offered": False, "reason": "outbox_unavailable"})
                if not calls:
                    if (response.get("content") or "").strip():
                        self.conversation_continuation = False
                    offer_narration()
                    self.invalid_tool_calls = 0
                    self.publish(invalid_tool_calls=0)
                    # A plain plan is still model history. Dropping it gives an
                    # unchanged world the same request on every idle wakeup.
                    self.groups.append([*([input_scene] if input_scene else []), assistant_history(response)])
                    self.retain_history()
                    # The body is already acting. A conversation or a lookahead
                    # reply is not idle failure, and must not leave a 60-second
                    # no-action timer behind its eventual native terminal.
                    if self.current_work():
                        return
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
                    prepared = self.prepare_calls(calls, round_tools)
                except ModelCallRejected as error:
                    self.reject_model_call(error, response, input_scene)
                    return
                offer_narration()
                self.invalid_tool_calls = 0
                self.publish(invalid_tool_calls=0)
                exchange = [*([input_scene] if input_scene else []), assistant_history(response)]
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
                self.retain_history()
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
        self.synchronize_goals()
        text = "Standing goal: " + standing_goal
        if self.historical_goal:
            text += "\nHistorical host proposal (requires fresh reassessment, not current intent): " + self.historical_goal["goal"]
            text += "\nUse current body facts and native receipts to choose useful local work under the user and standing goals. A host review, speech or lesson is not required before acting. Earlier coordinates are historical; only fresh explicit reassessment can restore this proposal as a stage."
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
        text += "\nIf receipts disprove the proposed method or its prerequisites, revise the method or report the stage blocked with observed evidence; repeating reads or ineffective work does not satisfy it."
        if self.feedback_pending:
            if origin == "user":
                text += "\nCurrent user feedback takes priority."
            text += "\nPlan through mc_do; the framework applies the requested native queue policy at its safe checkpoint."
        return text

    async def run(self, goal):
        from .recovery import require_no_pending_acknowledgement
        require_no_pending_acknowledgement(self.data)
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
            status = json_content(await self.bridge.call("mc_connection", {"action": "status"}))
            # Native startup retries have the same ownership and stop semantics
            # as a later connection loss. Do not discard a healthy retry loop
            # just because maintenance lasts longer than two minutes.
            if not online(status) and not await self.wait_for_native_reconnect(status):
                return
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
            self.publish(phase="running", game_connected=True, autonomy_running=self.decide is not None, current_goal=None)
            prefix = text_content(await self.bridge.resource("mc://environment"))
            tools = model_tools(self.bridge.tools, context_mode=self.settings.context_mode)
            wake, urgent = True, False
            last_status_check = time.monotonic()
            if self.commands:
                await self.observe_queue()
            while not self.stop_requested() and (self.settings.max_decisions == 0 or self.count < self.settings.max_decisions):
                # A durable CLI stop is not the external callback. Admit it
                # before native joins/hasMore loops, without admitting actions.
                await self.external_command(stop_only=True)
                if self.stop_requested():
                    break
                if self._event_poll is not None or self._deferred_event_drain:
                    drained = await self.join_deferred_events()
                    if drained is None or self.stop_requested():
                        break
                    event_wake, event_urgent, more = drained
                    wake |= event_wake
                    urgent |= event_urgent
                    if more:
                        await asyncio.sleep(0)
                        continue
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
                if (time.monotonic() - last_status_check >= 10 or
                        (self.decide and wake and (not self.current_work() or urgent or self.conversation_ready())
                         and time.monotonic() - self.last_decision >= self.settings.min_decision_seconds)):
                    status = json_content(await self.bridge.call("mc_connection", {"action": "status"}))
                    if not online(status):
                        if not await self.wait_for_native_reconnect(status):
                            break
                        wake = True
                    last_status_check = time.monotonic()
                    if self.commands:
                        await self.observe_queue()
                elapsed = time.monotonic() - self.last_decision
                lookahead = self.lookahead_candidate() if not (urgent or self.conversation_ready()) else None
                wake |= lookahead is not None
                if self.decide and not self.current_work() and elapsed >= self.settings.idle_decision_seconds:
                    # Poll state without a model request when nothing has changed.
                    wake |= fact_fingerprint(await self.protocol("facts")) != self.last_facts
                if (self.decide and wake and (not self.current_work() or urgent or self.conversation_ready() or lookahead)
                        and not self.death_waiting
                        and self.death_recovery is None
                        and (elapsed >= self.settings.min_decision_seconds or self.continuation_ready or lookahead)
                        and time.monotonic() >= self.planner_retry_at):
                    self.lookahead_anchor = lookahead
                    self.lookahead_invalidated = False
                    if lookahead:
                        self.lookahead_used.add(lookahead)
                    self.publish(planning_handoff={"mode": "native_lookahead" if lookahead else "ordinary",
                        "anchor": lookahead[1] if lookahead else None, "native_work_continues": bool(self.pending)})
                    try:
                        await self.turn_once(goal, prefix, tools)
                    finally:
                        self.lookahead_anchor = None
                        self.lookahead_invalidated = False
                    self.count += 1
                    self.last_decision = time.monotonic()
                    wake, urgent = self.preempted or self.deferred_wake or self.continuation_needed, self.preempted
                    self.publish(decisions=self.count, pending=list(self.pending.values()))
                await asyncio.sleep(1)
            self.publish(phase="stopped" if self.stop_requested() else "budget_exhausted")
        except Exception as error:
            from .failure_diagnostics import capture_current
            capture_current(error, "controller.run")
            raise
        finally:
            try:
                await self.close_event_poll()
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
