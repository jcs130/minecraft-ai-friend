import jsonschema
import pytest
from test_death_memory import SCOPE, event, facts

from agent_mc_autonomy.death_memory import TOOL, DeathMemory


@pytest.mark.parametrize("action", ["get", "report"])
def test_death_tool_schema_requires_explicit_episode_id(action):
    args = {"action": action}
    if action == "report":
        args.update(lesson="Take cover", applicability="Under arrow fire", evidence="native-run event 1")
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(args, TOOL["function"]["parameters"])
    jsonschema.validate({**args, "id": "death-1"}, TOOL["function"]["parameters"])
    jsonschema.validate({"action": "search"}, TOOL["function"]["parameters"])


def test_missing_id_reports_argument_error_without_selecting_latest_episode(tmp_path):
    store = DeathMemory(tmp_path)
    store.record(event(), facts(), [], [], [])
    with pytest.raises(ValueError, match="id is required.*search"):
        store.execute(SCOPE, {"action": "report", "lesson": "Take cover",
                             "applicability": "Under arrow fire", "evidence": "native-run event 1"})
    assert store.entries(SCOPE)[0]["lesson"] is None
    with pytest.raises(ValueError, match="current realm/account/agent"):
        store.execute({**SCOPE, "realm": "other"}, {"action": "get", "id": "death-1"})


def test_recovery_context_supplies_exact_scoped_read_arguments(tmp_path):
    store = DeathMemory(tmp_path)
    store.record(event(), facts(), [], [], [])
    context = store.context(SCOPE, facts())
    assert context["inspect"] == {"action": "get", "id": "death-1"}
    assert context["report_episode_id"] == "death-1"
    episode = store.execute(SCOPE, context["inspect"])
    assert episode["id"] == "death-1"
    assert episode["lesson"] is None
    assert store.context({**SCOPE, "realm": "other"}, facts()) is None
