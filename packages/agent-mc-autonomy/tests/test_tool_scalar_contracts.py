"""Compact tools still expose the backend's scalar generation constraints."""
import copy
import json

import pytest
from jsonschema import Draft202012Validator

from agent_mc_autonomy.controller import model_tools, tool_help


def catalogue():
    props = {
        "skill": {"type": "string", "enum": ["observe", "craft", "goto"]},
        "mode": {"type": "string", "enum": ["sites", "voxels", "rays"], "description": "Observation modes " * 80},
        "item": {"type": "string", "minLength": 1, "maxLength": 128, "description": "Item semantics " * 100},
        "count": {"type": "integer", "minimum": 1, "maximum": 64, "description": "Count of items."},
        "pitch": {"type": ["number", "null"], "minimum": -90, "maximum": 90},
        "mature": {"type": "boolean"},
        "shape": {"enum": ["line", "rect", "triangle", "arc", "box"]},
        "extension": True,
        "sites": {"type": "array", "maxItems": 4, "items": {"type": "array", "items": {"type": "integer"}}},
    }
    return [{"name": "mc_scout", "inputSchema": {"type": "object", "properties": {
        "steps": {"type": "array", "items": {"type": "object", "properties": props, "required": ["skill"]}}},
        "required": ["steps"]}}]


@pytest.mark.parametrize("field", ["mode", "item", "count", "pitch", "mature", "shape"])
def test_projection_keeps_native_scalar_structure_without_long_manuals(field):
    original = catalogue()
    before = copy.deepcopy(original)
    projected = model_tools(original)[0]["function"]["parameters"]["properties"]["steps"]["items"]
    expected = {k: v for k, v in original[0]["inputSchema"]["properties"]["steps"]["items"]["properties"][field].items() if k != "description"}
    if field == "count":
        # Output-count semantics are necessary arguments, not a long manual.
        expected["description"] = original[0]["inputSchema"]["properties"]["steps"]["items"]["properties"][field]["description"]
    assert projected["properties"][field] == expected
    assert projected["properties"]["sites"] == original[0]["inputSchema"]["properties"]["steps"]["items"]["properties"]["sites"]
    assert original == before
    expanded = json.loads(tool_help(original, {"name": "mc_scout", "path": "/inputSchema/properties/steps/items/properties/" + field})["text"])
    assert expanded == before[0]["inputSchema"]["properties"]["steps"]["items"]["properties"][field]


def test_projected_schema_rejects_illegal_scalar_values_without_global_skill_requirements():
    schema = model_tools(catalogue())[0]["function"]["parameters"]
    validator = Draft202012Validator(schema)
    for step in ({"skill": "observe", "mode": "blocks"}, {"skill": "craft", "count": 0},
                 {"skill": "craft", "count": True}, {"skill": "craft", "item": ""},
                 {"skill": "observe", "pitch": 180}):
        assert not validator.is_valid({"steps": [step]})
    assert validator.is_valid({"steps": [{"skill": "observe", "mode": "sites", "sites": [[1, 64, 2]]}]})
    assert validator.is_valid({"steps": [{"skill": "craft", "item": "stick", "count": 4}]})
    assert validator.is_valid({"steps": [{"skill": "goto", "at": [1, 64, 2]}]})
