"""Track proven correction contracts without imposing whole-planner delays."""
import hashlib
import json


def syntactic(failure):
    admission = failure.get("admission") or {}
    return (admission.get("accepted") is False and admission.get("dispatched") is False
            and admission.get("kind") == "correction"
            and admission.get("rule") in {"arguments.steps", "arguments.queue"}
            and not failure.get("native_execution"))


class ArgumentCorrections:
    def __init__(self):
        self.counts = {}

    def record(self, name, failure, scope):
        if not syntactic(failure):
            return None
        references = [{"tool": row.get("tool"), "arguments": row.get("arguments")}
                      for row in failure.get("recovery", [])]
        key = hashlib.sha256(json.dumps([scope, name, failure["admission"]["rule"],
            references, failure.get("correction_schema")], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        if key not in self.counts and len(self.counts) >= 16:
            self.counts.pop(next(iter(self.counts)))
        count = self.counts[key] = min(999, self.counts.get(key, 0) + 1)
        return {"attempts": count, "action_dispatched": False,
                "world_changes_do_not_correct_argument_shape": True,
                "next_step": "Supply the required typed fields from the native correction contract. "
                             "Writing a field name inside text is not supplying that field. "
                             "Only identical rejected arguments are fenced; corrected arguments and other tools remain available. "
                             "Alternatively inspect a genuinely missing prerequisite or explain a real wait; "
                             "no replacement action is automatically selected."}
