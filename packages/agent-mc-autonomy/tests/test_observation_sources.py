import copy
import json

import pytest

from agent_mc_autonomy.context import assemble
from agent_mc_autonomy.observations import spatial_text

SOURCES = ("client-loaded-world", "client-visible-world")


def voxel(source):
    return {"source": source, "observedAt": "2026-10-14T06:31:12.397Z", "dimension": "overworld",
            "frame": {"feet": [-2, 64, 7]}, "kind": "voxels", "bounds": [-2, 64, 7, -1, 64, 8],
            "order": "y,z,x; x fastest", "palette": [{"name": "air", "air": True}, {"name": "oak_log"}],
            "cells": [1, 0, -1, 1], "unknownCells": 1, "entities": []}


@pytest.mark.parametrize("source", SOURCES)
def test_native_voxel_sources_keep_unknown_cells_coordinates_and_original_handle(source):
    observation = voxel(source)
    prefix, suffix = "Task #7 completed: ", "\nNo placement or movement was performed."
    original = prefix + json.dumps(observation) + suffix
    facts = {"parts": [{"key": "lastTask", "text": original, "original": "log:task-7"}]}
    before = copy.deepcopy(facts)

    messages, budget = assemble("stable", [], "survive", facts, [], [],
                                context_tokens=6000, reserved_output=1024)
    tail = json.loads(messages[-1]["content"])
    fact = tail["current_facts"][0]
    assert fact["original"] == "log:task-7"
    assert fact["text"].startswith(prefix) and fact["text"].endswith(suffix)
    summary = json.loads(fact["text"][len(prefix):-len(suffix)])
    assert summary["source"] == source
    assert summary["observedAt"] == observation["observedAt"]
    assert summary["dimension"] == "overworld" and summary["bounds"] == observation["bounds"]
    assert summary["feet"] == [-2, 64, 7] and summary["unknownCells"] == 1
    assert summary["materials"] == [{"name": "air", "count": 1},
                                    {"name": "oak_log", "count": 2, "example_at": [-2, 64, 7]}]
    assert "cells" not in summary and "palette" not in summary
    assert "safe" not in summary and "passable" not in summary
    assert facts == before and not tail["omitted_facts"] and budget["total"] <= 6000


@pytest.mark.parametrize("source", SOURCES)
def test_native_ray_sources_preserve_actual_view_frame_and_unknown_hits(source):
    observation = {"source": source, "kind": "rays",
                   "frame": {"feet": [-2, 64, 7], "eye": [-1.5, 65.62, 7.5], "yawDeg": 180, "pitchDeg": 90},
                   "geometry": "eye-origin collision rays; unknown collar stops verification",
                   "rays": [{"pitchDeg": 0, "yawDeg": yaw, "range": 24, "direction": [0, 1, 0],
                             "first": "unknown", "terrain": {"kind": "unknown", "cell": [-2, 67, 7],
                                                             "distance": 1.38, "reason": "unloaded"}}
                            for yaw in (0, 45, 90, 135, 180)]}
    original = json.dumps(observation)
    summary = json.loads(spatial_text(original))
    assert summary["source"] == source and summary["frame"] == observation["frame"]
    assert summary["geometry"] == observation["geometry"] and summary["rays_omitted"] == 1
    assert len(summary["rays"]) == 4
    for ray in summary["rays"]:
        assert ray["direction"] == [0, 1, 0] and ray["first"] == "unknown"
        assert ray["terrain"] == {"kind": "unknown", "cell": [-2, 67, 7], "distance": 1.38}
    assert json.dumps(observation) == original


@pytest.mark.parametrize("source", SOURCES)
def test_sites_are_preserved_verbatim(source):
    original = "Task completed: " + json.dumps({"source": source, "kind": "sites", "sites": []})
    assert spatial_text(original) == original


@pytest.mark.parametrize("source", ("external-world", "client-visible-world-extra", "client-other-world"))
def test_unrecognized_sources_are_preserved_verbatim(source):
    original = "Task completed: " + json.dumps(voxel(source))
    assert spatial_text(original) == original


@pytest.mark.parametrize("source", SOURCES)
@pytest.mark.parametrize("invalid", ("unfinished-json", "wrong-order", "wrong-size", "malformed-frame"))
def test_unrecognized_observation_structure_is_preserved_verbatim(source, invalid):
    observation = voxel(source)
    if invalid == "wrong-order":
        observation["order"] = "x,y,z"
    elif invalid == "wrong-size":
        observation["cells"] = [0]
    elif invalid == "malformed-frame":
        observation["frame"] = []
    original = json.dumps(observation)
    if invalid == "unfinished-json":
        original = original[:-1]
    assert spatial_text(original) == original
