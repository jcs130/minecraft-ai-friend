import copy

import pytest

from agent_mc_autonomy.controller import model_tools


@pytest.mark.parametrize("mode", ["full", "compact"])
def test_scout_description_retains_native_paging_contract_without_inventing_a_total_volume_limit(mode):
    native = {
        "name": "mc_scout",
        "description": "Queue read-only observations. Oversized voxel regions return actual partial data; "
                       "the returned cursor may be used for another caller-selected page. "
                       "Default visible pages bound surface results and checks independently of total region volume.",
        "inputSchema": {"type": "object", "properties": {"steps": {"type": "array", "items": {"type": "object"}}}},
    }
    before = copy.deepcopy(native)
    projected = model_tools([native], context_mode=mode)[0]["function"]
    assert projected["description"] == native["description"]
    assert native == before
