import importlib
import json


def test_native_menu_preview_retains_hotbar_components_and_empty_container_slots(framework_module):
    module=importlib.import_module('agent_mc_autonomy.observations')
    snbt='{id:"example:alloy",count:4,components:{"minecraft:custom_name":"精确名字"}}'
    slots=[{'slot':i,'owner':'container' if i<5 else 'player','item':None} for i in range(46)]
    slots[36]['item']={'id':'example:alloy','name':'合金','count':4,'snbt':snbt,'componentTypes':['example:large']*500}
    native={'ok':True,'bodyId':'same','state':{'windowId':0,'stateId':7,'carried':None,'slots':slots}}
    original=json.dumps(native,ensure_ascii=False)
    result=module.receipt_view({'text':original,'failed':False})
    menu=json.loads(result['text'])['state']
    assert [r['slot'] for r in menu['slots']]==[0,1,2,3,4,36]
    assert menu['slots'][-1]['item']['snbt']==snbt
    assert menu['stateId']==7 and 37 in menu['emptyPlayerSlots'] and 36 not in menu['emptyPlayerSlots']
    assert len(result['text'].encode('utf-8'))<2000
    assert json.dumps(native,ensure_ascii=False)==original


def test_native_recipe_projection_never_rewrites_mod_serializer_json(framework_module):
    module=importlib.import_module('agent_mc_autonomy.observations')
    native={'bodyId':'same','authority':'client_observed','nativeJson':{'results':[{'id':'example:output','count':2,'snbt':'raw','chance':0.5}]}}
    assert json.loads(module.native_text_preview(json.dumps(native)))['nativeJson']==native['nativeJson']
    assert module.native_text_preview('unstructured game text')=='unstructured game text'


def test_ray_preview_preserves_the_view_frame_and_actual_world_direction(framework_module):
    module = importlib.import_module("agent_mc_autonomy.observations")
    # After collecting overhead wood, local pitch=0 points up, not horizontally.
    observation = {"source": "client-loaded-world", "kind": "rays",
        "frame": {"feet": [-64, 72, 318], "eye": [-63.5, 73.62, 318.5], "yawDeg": -180, "pitchDeg": 90},
        "geometry": "eye-origin collision rays; offsets are degrees; unknown collar stops verification",
        "rays": [{"pitchDeg": 0, "yawDeg": yaw, "range": 24, "direction": [0, 1, 0], "first": "block",
                  "terrain": {"kind": "block", "cell": [-64, 75, 318], "distance": 1.38, "material": {"name": "oak_log"}}}
                 for yaw in (0, 90, 180, -90, 45)]}
    original = json.dumps(observation)
    preview = json.loads(module.spatial_text(original))
    assert preview["frame"] == observation["frame"]
    assert preview["geometry"] == observation["geometry"]
    assert all(ray["direction"] == [0, 1, 0] for ray in preview["rays"])
    assert preview["rays_omitted"] == 1
    assert json.dumps(observation) == original


def test_voxel_receipt_keeps_real_material_coordinates_and_original(framework_module):
    context = importlib.import_module("agent_mc_autonomy.context")
    observation = {"source": "client-loaded-world", "observedAt": "now", "kind": "voxels", "dimension": "overworld",
                   "frame": {"feet": [-2, 64, 7]}, "bounds": [-2, 64, 7, 5, 71, 14], "order": "y,z,x; x fastest",
                   "palette": [{"name": "air", "air": True}, {"name": "oak_log"}], "cells": [1] + [0] * 511,
                   "unknownCells": 0, "entities": []}
    original = "Task completed: " + json.dumps(observation)
    facts = {"parts": [{"key": "lastTask", "text": original, "original": "log:complete"}]}
    messages, budget = context.assemble("stable", [], "survive", facts, [], [], context_tokens=6000, reserved_output=1024)
    tail = json.loads(messages[-1]["content"])
    assert not tail["omitted_facts"]
    brief = tail["current_facts"][0]
    assert brief["original"] == "log:complete"
    assert '"name":"oak_log"' in brief["text"] and '[-2,64,7]' in brief["text"]
    assert '"count":1' in brief["text"] and '"unknownCells":0' in brief["text"]
    assert '"cells"' not in brief["text"]
    assert facts["parts"][0]["text"] == original
    assert budget["total"] <= 6000


def test_spatial_summary_never_turns_unread_cells_into_air(framework_module):
    module = importlib.import_module("agent_mc_autonomy.observations")
    observation = {"source": "client-loaded-world", "kind": "voxels", "frame": {"feet": [0, 0, 0]},
                   "bounds": [0, 0, 0, 1, 0, 0], "order": "y,z,x; x fastest", "palette": [{"name": "air", "air": True}],
                   "cells": [0, None], "unknownCells": 1}
    brief = json.loads(module.spatial_text(json.dumps(observation)))
    assert brief["materials"] == [{"name": "air", "count": 1}]
    assert brief["unknownCells"] == 1
    assert "passable" not in brief and "safe" not in brief


def test_malformed_or_differently_ordered_observation_is_preserved(framework_module):
    module = importlib.import_module("agent_mc_autonomy.observations")
    for text in ('{"source":"client-loaded-world","kind":"voxels"',
                 '{"source":"client-loaded-world","kind":"voxels","order":"unknown"}'):
        assert module.spatial_text(text) == text


def test_large_terminal_task_remains_visible_when_full_result_does_not_fit(framework_module):
    context = importlib.import_module("agent_mc_autonomy.context")
    _, base = context.assemble("stable", [], "survive", {"parts": []}, [], [], context_tokens=32768, reserved_output=1024)
    text = "[最近一单] completed\n" + "观测几何" * 5000 + "\ncoal_ore at (-4,63,12)"
    facts = {"parts": [{"key": "lastTask", "text": text, "original": "log:terminal"}]}
    messages, budget = context.assemble("stable", [], "survive", facts, [], [], context_tokens=base["total"] + 2600, reserved_output=1024)
    task = json.loads(messages[-1]["content"])["current_facts"][0]
    assert task["abridged"] and task["original"] == "log:terminal"
    assert "completed" in task["text"] and "coal_ore at (-4,63,12)" in task["text"]
    assert "abridged" in task["text"] and budget["total"] <= base["total"] + 2600


def test_large_validation_failure_cannot_overflow_an_otherwise_valid_context(framework_module):
    context = importlib.import_module("agent_mc_autonomy.context")
    failure = {"tool": "mc_do", "error": "voxel request exceeds 512 cells: " + "参数" * 2000,
               "arguments": "steps" * 1000, "next_step": "Use a smaller observed area", "parameter_help": {"x": "x" * 8000}}
    facts = {"parts": [{"key": "body", "text": "health 10/20", "original": "log:h"}]}
    messages, budget = context.assemble("p" * 25000, [], "survive", facts, [], [],
                                      context_tokens=32768, reserved_output=2048, tool_failure=failure)
    tail = json.loads(messages[-1]["content"])
    assert tail["tool_failure"] and tail["current_facts"] == facts["parts"]
    assert budget["total"] <= 32768
    assert len(failure["arguments"]) == 5000


def test_completed_observation_takes_priority_over_old_read_acceptance(framework_module):
    context = importlib.import_module("agent_mc_autonomy.context")
    history = [[{"role": "assistant", "content": None, "tool_calls": [{"id": "q", "type": "function",
        "function": {"name": "mc_scout", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "q", "content": "accepted " + "x" * 1600}]]
    facts = {"parts": [{"key": "body", "text": "healthy", "original": "log:health"},
                       {"key": "lastTask", "text": "completed: " + "rays " * 350 + "oak_log at 4,64,9", "original": "log:rays"}]}
    _, base = context.assemble("stable", [], "survive", {"parts": []}, [], [], context_tokens=32768, reserved_output=1024)
    messages, budget = context.assemble("stable", [], "survive", facts, [], history,
                                       context_tokens=base["total"] + 2700, reserved_output=1024)
    assert len(messages) == 3 and len(history[0]) == 2
    assert "oak_log at 4,64,9" in messages[-1]["content"]
    assert budget["total"] <= base["total"] + 2700


def test_current_inventory_receipt_is_not_replaced_by_an_older_scout_fact(framework_module):
    context = importlib.import_module("agent_mc_autonomy.context")
    receipt = "CURRENT INVENTORY: wooden_pickaxe x1, stick x6 " + "inventory " * 40
    history = [[{"role": "assistant", "content": None, "tool_calls": [{"id": "bag", "type": "function",
        "function": {"name": "mc_bag", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "bag", "content": receipt}]]
    facts = {"parts": [{"key": "lastTask", "text": "older scout completed " + "geometry " * 300, "original": "log:old-scout"}]}
    _, base = context.assemble("stable", [], "survive", {"parts": []}, [], [], context_tokens=32768, reserved_output=1024)
    messages, budget = context.assemble("stable", [], "survive", facts, [], history,
                                       context_tokens=base["total"] + 2700, reserved_output=1024)
    assert any(message.get("role") == "tool" and message.get("content") == receipt for message in messages)
    assert budget["total"] <= base["total"] + 2700


def test_internal_fact_hashes_cannot_evict_the_action_result(framework_module):
    context = importlib.import_module("agent_mc_autonomy.context")
    facts = {"parts": [{"key": key, "text": "observed " + key, "revision": "a" * 64, "original": "log:" + "b" * 64}
                       for key in ("body", "place", "gear", "foodReserve", "queue")]}
    facts["parts"].append({"key": "lastTask", "text": "placement failed: occupied by grass_block; empty at (1,65,2)",
                           "revision": "c" * 64, "original": "log:" + "d" * 64})
    _, base = context.assemble("stable", [], "survive", {"parts": []}, [], [], context_tokens=32768, reserved_output=1024)
    messages, budget = context.assemble("stable", [], "survive", facts, [], [],
                                       context_tokens=base["total"] + 1150, reserved_output=1024)
    tail = json.loads(messages[-1]["content"])
    task = next(f for f in tail["current_facts"] if f["key"] == "lastTask")
    assert "empty at (1,65,2)" in task["text"]
    assert task["original"] == facts["parts"][-1]["original"]
    assert not any("revision" in f for f in tail["current_facts"])
    assert facts["parts"][0]["revision"] == "a" * 64
    assert budget["total"] <= base["total"] + 1150


def test_json_rich_terminal_fits_by_serialized_cost_with_latest_bag_result(framework_module):
    context = importlib.import_module("agent_mc_autonomy.context")
    receipt = 'CURRENT INVENTORY: {"wooden_sword":1,"food":0}'
    history = [[{"role": "assistant", "content": None, "tool_calls": [{"id": "bag", "type": "function",
        "function": {"name": "mc_bag", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "bag", "content": receipt}]]
    # Native observations are JSON inside text inside the messages JSON. Their
    # escaping overhead disappears when shortened; raw byte subtraction is wrong.
    text = "Task completed: " + json.dumps({"samples": [{"name": "oak_log", "at": [1, 64, 2]}] * 120}) + " END: food absent"
    facts = {"parts": [{"key": "body", "text": "health 20/20"},
                       {"key": "lastTask", "text": text, "original": "log:terminal"}]}
    _, base = context.assemble("stable", [], "survive", {"parts": []}, [], history,
                               context_tokens=32768, reserved_output=1024)
    limit = base["total"] + 1800
    messages, budget = context.assemble("stable", [], "survive", facts, [], history,
                                       context_tokens=limit, reserved_output=1024)
    tail = json.loads(messages[-1]["content"])
    task = next(f for f in tail["current_facts"] if f["key"] == "lastTask")
    assert task["abridged"] and task["original"] == "log:terminal"
    assert "Task completed" in task["text"] and "END: food absent" in task["text"]
    assert any(message.get("content") == receipt for message in messages)
    assert len(task["text"].encode("utf-8")) >= 700 and budget["total"] <= limit
    assert facts["parts"][-1]["text"] == text and history[0][1]["content"] == receipt


def test_budget_reports_omissions_even_when_original_handle_cannot_fit(framework_module):
    context = importlib.import_module("agent_mc_autonomy.context")
    _, base = context.assemble("stable", [], "survive", {"parts": []}, [], [],
                               context_tokens=32768, reserved_output=1024)
    facts = {"parts": [{"key": "chat", "text": "word " * 1000, "original": "log:" + "a" * 64}]}
    messages, budget = context.assemble("stable", [], "survive", facts, [], [],
                                       context_tokens=base["total"] + 5, reserved_output=1024)
    assert not json.loads(messages[-1]["content"])["current_facts"]
    assert budget["omitted"] == ["chat"]
    assert budget["total"] <= base["total"] + 5


def test_large_task_geometry_does_not_hide_nearby_food_terrain_or_existing_workbench(framework_module):
    context = importlib.import_module("agent_mc_autonomy.context")
    facts = {"parts": [{"key": "body", "text": "health 20/20"},
                       {"key": "lastTask", "text": "completed: " + "geometry " * 1000, "original": "log:task"},
                       {"key": "life", "text": "cow at (12,64,7)"},
                       {"key": "terrain", "text": "east is level; south is loaded uphill"},
                       {"key": "structure", "text": "crafting_table at (1,64,2)"}]}
    _, base = context.assemble("stable", [], "survive", {"parts": []}, [], [],
                               context_tokens=32768, reserved_output=1024)
    messages, budget = context.assemble("stable", [], "survive", facts, [], [],
                                       context_tokens=base["total"] + 2000, reserved_output=1024)
    fresh = {f["key"]: f for f in json.loads(messages[-1]["content"])["current_facts"]}
    assert set(fresh) == {"body", "lastTask", "life", "terrain", "structure"}
    assert fresh["life"]["text"] == "cow at (12,64,7)"
    assert fresh["lastTask"]["abridged"] and fresh["lastTask"]["original"] == "log:task"
    assert budget["total"] <= base["total"] + 2000


def test_full_facts_can_share_archive_lookup_to_keep_terminal_evidence(framework_module):
    context = importlib.import_module("agent_mc_autonomy.context")
    facts = {"parts": [{"key": key, "text": "observed " + key, "original": "log:" + "a" * 64}
                       for key in ("body", "place", "gear", "foodReserve", "queue", "life", "terrain", "structure")]}
    facts["parts"].append({"key": "lastTask", "text": "completed: " + "observed geometry " * 300, "original": "log:task"})
    original = json.dumps(facts)
    _, base = context.assemble("stable", [], "survive", {"parts": []}, [], [],
                               context_tokens=32768, reserved_output=1024)
    messages, budget = context.assemble("stable", [], "survive", facts, [], [],
                                       context_tokens=base["total"] + 1600, reserved_output=1024)
    tail = json.loads(messages[-1]["content"])
    fresh = {f["key"]: f for f in tail["current_facts"]}
    assert set(fresh) == {f["key"] for f in facts["parts"]}
    assert fresh["lastTask"]["original"] == "log:task" and fresh["lastTask"]["abridged"]
    assert "mc_protocol" in tail["originals"] and "facts/archive" in tail["originals"]
    assert fresh["gear"]["text"] == "observed gear" and json.dumps(facts) == original
    assert budget["total"] <= base["total"] + 1600
