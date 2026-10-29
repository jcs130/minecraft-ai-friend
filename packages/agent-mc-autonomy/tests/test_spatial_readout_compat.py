"""Consume the public sparse voxel envelope used by queued core128 observations."""
import copy
import importlib
import json

import pytest

from test_controller import action
from test_observation_reuse import prepare


def visible_readout():
    # Sparse surfaces can cover more than 512 requested cells. Unknown cells
    # remain absent from blocks; they are not an unfinished native execution.
    return {
        "readout": {
            "protocol": "agent-mc-spatial-read/v1", "historical": False,
            "kind": "voxels", "selection": "a" * 64, "revision": "b" * 64,
            "scanComplete": True, "knownComplete": False, "remainingCount": 0,
            "unknownCount": 1822, "unknownUnit": "cells", "retryable": False,
            "continuationAvailable": False, "interpretation": "Unknown is not air or another queued page.",
        },
        "source": "client-visible-world", "observedAt": "2026-10-29T11:08:33Z",
        "dimension": "minecraft:overworld", "frame": {"feet": [0, 64, 0], "eye": [.5, 65.62, .5], "yawDeg": 83, "pitchDeg": 0},
        "kind": "voxels", "format": "visible", "coordinate_system": "absolute_block",
        "coverage": {"coordinateFrame": "absolute block coordinates; inclusive bounds",
                     "origin": [0, 64, 0], "requestedBounds": [-8, 62, -8, 8, 68, 8],
                     "requestedCount": 2023, "scannedCount": 2023, "remainingCount": 0,
                     "returnedCount": 3, "invisibleCount": 1822, "unloadedCount": 0,
                     "omittedDetailCount": 0, "airCount": 198},
        "palette": [{"name": "spruce_wood", "stateId": 193, "properties": {"axis": "y"}, "air": False},
                    {"name": "stone_pressure_plate", "stateId": 5651, "properties": {"powered": False}, "air": False}],
        "blocks": [[0, 63, 0, 0], [1, 63, 0, 0], [-1, 64, 0, 1]],
        "requested_bounds": [-8, 62, -8, 8, 68, 8],
        "next_safe_read": None,
    }


def test_sparse_readout_first_key_is_retained_in_measured_observation(framework_module):
    module = importlib.import_module("agent_mc_autonomy.observations")
    value = visible_readout()
    text = "Native task completed:\n" + json.dumps(value)
    summaries = module.spatial_observations(text)
    assert len(summaries) == 1, "the current native envelope is silently omitted"
    brief = summaries[0]
    assert brief["readout"] == value["readout"]
    assert brief["coverage"] == value["coverage"]
    assert brief["requested_bounds"] == value["requested_bounds"]
    assert brief["format"] == "visible" and brief["next_safe_read"] is None
    assert brief["materials"] == [
        {"name": "spruce_wood", "count": 2, "example_at": [0, 63, 0]},
        {"name": "stone_pressure_plate", "count": 1, "example_at": [-1, 64, 0]},
    ]
    assert "cells" not in brief and "blocks" not in brief
    assert not any(item["name"] == "air" for item in brief["materials"])
    assert value == visible_readout(), "the source observation must stay exact"


def test_sparse_receipt_preview_keeps_real_continuation_and_absolute_coordinates(framework_module):
    module = importlib.import_module("agent_mc_autonomy.observations")
    value = visible_readout()
    value["readout"].update(scanComplete=False, remainingCount=100, continuationAvailable=True)
    value["coverage"]["remainingCount"] = 100
    value["next_safe_read"] = {"mode": "voxels", "format": "visible", "cursor": "original:opaque-handle"}
    # Object order is not a protocol field. Both current and reordered objects
    # must work; objects quoted inside a JSON string must not become evidence.
    reordered = dict(reversed(list(value.items())))
    receipt = "One result: " + json.dumps(reordered)
    preview = module.spatial_text(receipt)
    brief = json.loads(preview.removeprefix("One result: "))
    assert "blocks" not in brief and "palette" not in brief
    assert brief["readout"] == value["readout"]
    assert brief["next_safe_read"] == value["next_safe_read"]
    assert brief["frame"]["feet"] == [0, 64, 0]
    assert brief["requested_bounds"] == [-8, 62, -8, 8, 68, 8]
    assert "safe" not in brief and "passable" not in brief
    assert module.spatial_observations(json.dumps({"text": json.dumps(value)})) == []


@pytest.mark.parametrize("change", ["palette", "position", "protocol", "frame", "count", "boolean"])
def test_unrecognized_or_malformed_sparse_geometry_is_not_summarized(framework_module, change):
    module = importlib.import_module("agent_mc_autonomy.observations")
    value = visible_readout()
    if change == "palette":
        value["blocks"][0][3] = 1000
    elif change == "position":
        value["blocks"][0][0] = .5
    elif change == "protocol":
        value["readout"]["protocol"] = "future-unknown/v2"
    elif change == "frame":
        value["coordinate_system"] = "relative"
    elif change == "count":
        value["readout"]["unknownCount"] = -1
    else:
        value["readout"]["scanComplete"] = "false"
    text = json.dumps(value)
    assert module.spatial_observations(text) == []
    assert module.spatial_text(text) == text


def test_new_sites_and_rays_retain_typed_coverage_and_frame(framework_module):
    module = importlib.import_module("agent_mc_autonomy.observations")
    for kind in ("sites", "rays"):
        value = visible_readout()
        value["kind"] = value["readout"]["kind"] = kind
        value["readout"]["unknownUnit"] = "sites" if kind == "sites" else None
        value["sites"] = [{"at": [1, 64, 2], "target": None, "body": {"clear": None}}]
        value["rays"] = [{"yawDeg": 0, "pitchDeg": 45, "range": 5, "terrain": {"kind": "unknown"}}]
        observed = module.spatial_observations(json.dumps(value))
        assert len(observed) == 1 and observed[0]["readout"] == value["readout"]
        if kind == "rays":
            assert observed[0]["frame"] == value["frame"]
            assert observed[0]["rays"][0]["terrain"] == {"kind": "unknown"}
        else:
            assert observed[0]["sites"] == value["sites"]
        value["readout"]["protocol"] = "future-unknown/v2"
        assert module.spatial_observations(json.dumps(value)) == []


def test_current_native_event_is_reusable_with_original_completion_not_acceptance(framework_module, tmp_path, run_async):
    bridge, controller = prepare(framework_module, tmp_path)
    plan = {"steps": [{"skill": "observe", "mode": "voxels", "bounds": [-8, -2, -8, 8, 4, 8]}]}
    first = run_async(controller.execute_model_call("mc_do", copy.deepcopy(plan)))[0]
    assert first["execution"]["terminal"] is False
    terminal = {**action(True), "evidence": {"receipt": json.dumps(visible_readout()), "steps": [{"step": 1, "outcome": "ok"}]}}
    bridge.event_pages.append([{"run": "run-1", "cursor": 7, "contextDelivery": "deliver",
                               "execution": terminal, "text": terminal["evidence"]["receipt"]}])
    run_async(controller.events())
    repeated = run_async(controller.execute_model_call("mc_do", copy.deepcopy(plan)))[0]
    assert repeated["code"] == "observation_already_answered" and repeated["dispatched"] is False
    observed = repeated["previous_observation"]
    assert observed["fresh"] is False and observed["original_event"] == {"run": "run-1", "cursor": 7}
    assert observed["observations"][0]["readout"]["unknownCount"] == 1822
    assert observed["observations"][0]["readout"]["scanComplete"] is True
    assert "receipt" not in observed, "a parsed result must not fall back to its unbounded whole receipt"
    assert len([call for call in bridge.calls if call[0] == "mc_do"]) == 1
