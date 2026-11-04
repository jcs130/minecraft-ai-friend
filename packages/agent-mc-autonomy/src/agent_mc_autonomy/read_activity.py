"""Exact synchronous reads and observation counters, never body authority."""

# Keep the existing immediate/read-chain policy separate from newer observation
# ports: recording an answer must not grant lookahead or multi-call permission.
READ_ACTIVITY_TOOLS = {"mc_help", "mc_knowledge", "mc_scout", "mc_protocol", "mc_bag", "mc_queue", "mc_blocked", "mc_tool_help", "mc_original", "mc_capabilities", "mc_operations", "mc_result", "mc_notices", "mc_messages", "mc_query"}
OBSERVATION_TOOLS = {"mc_observe", "mc_check", "mc_visual"}
COUNTER_TOOLS = READ_ACTIVITY_TOOLS | OBSERVATION_TOOLS | {"mc_do", "mc_map", "mc_blueprint", "mc_options", "mc_memory", "mc_script"}

_MEMORY_READ_FIELDS = {
    "help": {"action", "topic"},
    "search": {"action", "query", "tags", "kind", "dimension", "limit", "offset", "includeArchived", "preference"},
    "get": {"action", "id", "revision"},
}


def additional_immediate_read(name, arguments):
    """Exact synchronous read forms, after native argument validation.

    These ports do not enqueue work. A read-only *program* or mc_scout still
    has a native execution lifecycle and must remain last in a batch. Never
    infer purity from a mixed tool's name/tags or from arbitrary program text.
    This classification grants no lookahead, cache or replay permission.
    """
    if not isinstance(arguments, dict):
        return False
    if name in {"mc_observe", "mc_check"}:
        return True
    if name in {"mc_map", "mc_blueprint"}:
        return arguments == {}
    if name == "mc_memory":
        action = arguments.get("action")
        fields = _MEMORY_READ_FIELDS.get(action) if isinstance(action, str) else None
        return fields is not None and set(arguments) <= fields
    if name == "mc_script":
        if not arguments:
            return True  # inspect the existing run list, not execute a program
        if set(arguments) == {"api"}:
            return isinstance(arguments["api"], str) and bool(arguments["api"].strip())
        return (set(arguments) <= {"runId", "call"}
                and type(arguments.get("runId")) is int and arguments["runId"] > 0
                and ("call" not in arguments or type(arguments["call"]) is int and arguments["call"] > 0))
    return False


def read_activity_view(value):
    """Project already-classified successful reads, including mixed-tool reads.

    mc_do/map/blueprint counters are supplied only for their read-only forms.
    Their names here do not classify an arbitrary call or attest goal progress.
    """
    if not isinstance(value, dict):
        return {}
    return {key: min(999, value[key]) for key in sorted(COUNTER_TOOLS)
            if type(value.get(key)) is int and value[key] > 0}
