"""Validate discovered native tool contracts before recording a possible dispatch."""

from jsonschema import validators
from referencing import Registry


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
