"""Reproduce recipient provider rejections through actual catalogue projection."""
import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from agent_mc_autonomy.controller import model_tools
from agent_mc_autonomy.tool_schema import argument_error


def test_discovered_duplicate_names_do_not_reach_provider():
    native = [{"name": "mc_help", "description": "first", "inputSchema": {"type": "object"}}]
    native.append({**copy.deepcopy(native[0]), "description": "second"})
    original = copy.deepcopy(native)
    tools = model_tools(native)
    names = [t["function"]["name"] for t in tools]
    assert names.count("mc_help") == 1
    assert tools[0]["function"]["description"] == "first"
    assert native == original


def test_real_native_tuple_schema_is_provider_compatible_and_native_validation_stays_positional():
    native = json.loads((Path(__file__).parent / "fixtures/native-step-tools.json").read_text(encoding="utf-8"))
    original = copy.deepcopy(native)
    tools = model_tools(native)
    parameters = next(t["function"]["parameters"] for t in tools if t["function"]["name"] == "mc_do")
    def inspect(value):
        if isinstance(value, dict):
            assert not isinstance(value.get("items"), list), "provider rejects tuple items arrays"
            assert "prefixItems" not in value, "provider requires homogeneous items"
            for child in value.values():
                inspect(child)
        elif isinstance(value, list):
            for child in value:
                inspect(child)
    inspect(parameters)
    Draft202012Validator.check_schema(parameters)
    valid = {"steps": [{"skill": "observe", "mode": "rays", "rays": [[0, 170, 32]]}]}
    assert argument_error(native, "mc_do", valid) is None
    assert argument_error(native, "mc_do", {"steps": [{"skill": "observe", "mode": "rays", "rays": [[170, 0, 32]]}]})
    assert native == original


@pytest.mark.parametrize("keyword", ["items", "prefixItems"])
def test_tuple_projection_keeps_length_and_position_guidance(keyword):
    tuple_schema = {"type": "array", "minItems": 2, "maxItems": 2,
                    keyword: [{"type": "number", "minimum": -90, "maximum": 90}, {"type": "string"}]}
    schema = {"type": "object", "properties": {"point": tuple_schema}}
    native = [{"name": "mc_help", "inputSchema": schema}]
    parameters = model_tools(native)[0]["function"]["parameters"]
    point = parameters["properties"]["point"]
    assert isinstance(point["items"], (dict, bool)) and "prefixItems" not in point
    assert point["minItems"] == point["maxItems"] == 2
    assert "0" in point["description"] and "90" in point["description"]


def test_local_references_and_literal_values_are_not_deleted_or_rewritten():
    native = [{"name": "mc_help", "inputSchema": {"type": "object",
        "$defs": {"point": {"type": "array", "minItems": 2, "maxItems": 2,
                             "prefixItems": [{"type": "number"}, {"type": "string"}]}},
        "properties": {"point": {"$ref": "#/$defs/point"}, "literal": {"const": {"items": [1, 2]}}}}}]
    schema = model_tools(native)[0]["function"]["parameters"]
    assert schema["properties"]["point"]["$ref"] == "#/$defs/point"
    assert schema["properties"]["literal"]["const"] == {"items": [1, 2]}
    assert Draft202012Validator(schema).is_valid({"point": [1, "s"], "literal": {"items": [1, 2]}})
