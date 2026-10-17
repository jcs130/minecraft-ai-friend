"""Validate discovered native tool contracts before recording a possible dispatch."""

import copy
import json

from jsonschema import validators
from referencing import Registry


def provider_schema(schema):
    """Project tuple contracts for homogeneous-items provider APIs only.

    Original native schemas remain authoritative at dispatch. Keep references
    and definitions together: deleting either would silently remove constraints.
    """
    maps = {"properties", "patternProperties", "$defs", "definitions", "dependentSchemas"}
    singles = {"items", "additionalItems", "additionalProperties", "unevaluatedProperties", "unevaluatedItems",
               "contains", "propertyNames", "not", "if", "then", "else"}
    lists = {"allOf", "anyOf", "oneOf", "prefixItems"}

    def project(value):
        if not isinstance(value, dict):
            return copy.deepcopy(value)
        result = {}
        for key, child in value.items():
            if key == "$schema":
                continue  # Outbound projection has a single modern dialect.
            if key in maps and isinstance(child, dict):
                result[key] = {name: project(item) for name, item in child.items()}
            elif key in lists or key == "items" and isinstance(child, list):
                result[key] = [project(item) for item in child]
            elif key in singles:
                result[key] = project(child)
            else:
                result[key] = copy.deepcopy(child)  # enum/const contain data, not schemas.
        positional = result.pop("prefixItems", None)
        legacy = isinstance(result.get("items"), list)
        if legacy:
            positional = result.pop("items")
        if positional is not None:
            tail = result.pop("additionalItems", True) if legacy else result.pop("items", True)
            if tail is False:
                result["maxItems"] = min(result.get("maxItems", len(positional)), len(positional))
            bounded = result.get("maxItems", float("inf")) <= len(positional)
            alternatives = list(positional)
            if not bounded and tail is not False:
                alternatives.append(tail)
            unique = []
            for item in alternatives:
                if item not in unique:
                    unique.append(item)
            result["items"] = True if True in unique else (unique[0] if len(unique) == 1 else {"anyOf": unique}) if unique else False
            guidance = json.dumps(dict(enumerate(positional)), ensure_ascii=False, separators=(",", ":"))[:1600]
            result["description"] = (result.get("description", "") + " Exact zero-based positions: " + guidance
                                     + ". Native validation enforces each position.").strip()
        return result

    return project(schema)


def argument_error(catalogue, name, arguments):
    schema = next((tool["inputSchema"] for tool in catalogue if tool["name"] == name), None)
    if schema is None:
        return None  # Framework-local tools validate their own contracts.
    # Discovered schemas may use local definitions, but validation must never
    # fetch remote references or silently coerce a string into an action plan.
    validator = validators.validator_for(schema)(schema, registry=Registry())
    try:
        error = next(validator.iter_errors(arguments), None)
    except Exception:
        return f"Invalid arguments: {name} native schema could not be resolved locally. No call was dispatched."
    if error is None:
        return None
    # The location and native constraint are sufficient; don't echo potentially
    # huge scripts or parameter values back into every subsequent request.
    constraint = error.schema.get(error.validator) if isinstance(error.schema, dict) else None
    return (f"Invalid arguments: {name}{error.json_path[1:]} violates native {error.validator}={constraint!r}. "
            "Read mc_help for the selected skill or mc_tool_help for the original schema; no call was dispatched.")[:700]
