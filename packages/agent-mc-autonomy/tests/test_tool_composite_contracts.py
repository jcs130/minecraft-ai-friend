"""Basic coordinates, observations and recipes are usable from native structure."""
import copy

import pytest
from jsonschema import Draft202012Validator

from agent_mc_autonomy.controller import model_tools


def catalogue():
    xyz = {"type": "array", "minItems": 3, "maxItems": 3, "items": {"type": "integer"}}
    fields = {
        "skill": {"type": "string", "enum": ["observe", "craft", "build"]},
        "mode": {"enum": ["sites", "rays", "voxels"], "description": "Mode manual " * 100},
        "sites": {"type": "array", "minItems": 1, "maxItems": 4, "items": xyz, "description": "Absolute [x,y,z] cells."},
        "rays": {"type": "array", "minItems": 1, "maxItems": 64, "items": {**xyz, "items": {"type": "number"}},
                 "description": "[pitch degrees,yaw degrees,range] triples."},
        "bounds": {"type": "array", "minItems": 6, "maxItems": 6, "items": {"type": "integer", "minimum": -16, "maximum": 16},
                   "description": "Relative foot bounds [xmin,ymin,zmin,xmax,ymax,zmax]."},
        "anchors": {"type": "array", "maxItems": 16, "items": xyz},
        "grid": {"type": "array", "maxItems": 3, "items": {"type": "array", "maxItems": 3, "items": {"type": ["string", "null"]}}},
    }
    step = {"type": "object", "properties": fields, "required": ["skill"], "additionalProperties": False}
    return [{"name": "mc_scout", "inputSchema": {"type": "object", "properties": {"steps": {"type": "array", "items": step}}}}]


@pytest.mark.parametrize("field", ["sites", "rays", "bounds", "anchors", "grid"])
def test_compact_tools_keep_full_composite_shape_and_short_units(field):
    native = catalogue()
    original = copy.deepcopy(native)
    result = model_tools(native)[0]["function"]["parameters"]["properties"]["steps"]["items"]
    assert result["properties"][field] == native[0]["inputSchema"]["properties"]["steps"]["items"]["properties"][field]
    assert result["properties"]["mode"] == {"enum": ["sites", "rays", "voxels"]}
    assert result["required"] == ["skill"] and result["additionalProperties"] is False
    assert native == original


def test_native_array_bounds_reject_invalid_shapes_without_inventing_conditional_required():
    schema = model_tools(catalogue())[0]["function"]["parameters"]
    validator = Draft202012Validator(schema)
    assert validator.is_valid({"steps": [{"skill": "observe", "mode": "sites", "sites": [[155, 64, 299]]}]})
    assert validator.is_valid({"steps": [{"skill": "observe", "mode": "voxels", "bounds": [-2, -1, -2, 2, 3, 2]}]})
    assert validator.is_valid({"steps": [{"skill": "craft", "grid": [["oak_planks", None], ["oak_planks", None]]}]})
    for field, value in (("sites", [[1, 2]]), ("rays", [[0, "east", 20]]), ("bounds", [-17, 0, 0, 1, 1, 1])):
        assert not validator.is_valid({"steps": [{"skill": "observe", field: value}]})
    assert validator.is_valid({"steps": [{"skill": "craft"}]})
