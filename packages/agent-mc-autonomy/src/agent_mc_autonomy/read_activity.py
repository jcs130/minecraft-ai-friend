"""Shared observation counter vocabulary, not an action admission policy."""

# Keep the existing immediate/read-chain policy separate from newer observation
# ports: recording an answer must not grant lookahead or multi-call permission.
READ_ACTIVITY_TOOLS = {"mc_help", "mc_knowledge", "mc_scout", "mc_protocol", "mc_bag", "mc_queue", "mc_blocked", "mc_tool_help", "mc_original", "mc_capabilities", "mc_operations", "mc_result", "mc_notices", "mc_messages", "mc_query"}
OBSERVATION_TOOLS = {"mc_observe", "mc_check", "mc_visual"}
COUNTER_TOOLS = READ_ACTIVITY_TOOLS | OBSERVATION_TOOLS | {"mc_do", "mc_map", "mc_blueprint", "mc_options"}


def read_activity_view(value):
    """Project already-classified successful reads, including mixed-tool reads.

    mc_do/map/blueprint counters are supplied only for their read-only forms.
    Their names here do not classify an arbitrary call or attest goal progress.
    """
    if not isinstance(value, dict):
        return {}
    return {key: min(999, value[key]) for key in sorted(COUNTER_TOOLS)
            if type(value.get(key)) is int and value[key] > 0}
