# agent-mc-harness-py

Lightweight **Python** harness runtime for server-hosted Minecraft bodies (active direction; the TypeScript harness in
`packages/agent-harness` stays as reference). Design, interfaces, capability matrix, reuse map and phase plan:
[`docs/agent-harness-design.md`](../../docs/agent-harness-design.md).

* Unified body adapter (`agent_mc_harness.body`): `NumenBody` (native Numen MCP via `numen_controller`, or hosted via
  `mc_numen`), `MaidBody` (Touhou Little Maid via `mc_maids`), `GuardedBody` safety layer.
* Runtime (`runtime.py`): intents, single body lease, System 0 → 1 → 2 scheduling (`fastslow.py`, `typed_choice.py`,
  `scheduler.py`), message gateway (`protocol.py`).
* Memory (`memory/`): hot ring · Graphiti (in-process sidecar service) · local SQLite fallback, `group_id` isolation.
* Learning (`learning/`): resident reflection, versioned self-iteration store, JitRL with goal-conditioned reward
  shaping, Harness² optimizer (pinned upstream via the existing bridge).

Everything is behind env flags that default **off** (`AGENT_HARNESS_PY_ENABLED`, `_EXECUTE`, `_MEMORY`, `_FASTSLOW`,
`_JITRL`; reflection is on only inside an enabled harness).

```python
from agent_mc_harness import Flags, Scope, create_harness
from agent_mc_harness.body.numen import NumenBody, HostedNumenPort
from agent_mc_harness.bridges import core_rpc_bridge
from agent_mc_harness.protocol import handle

body = NumenBody(HostedNumenPort(core_rpc_bridge()), scope=Scope(realm="qiandengji", account="owner", agent="cormy"))
rt = create_harness(body, Flags.from_env())          # None unless AGENT_HARNESS_PY_ENABLED=1
await body.spawn(); rt.start()
reply = await handle(rt, {"v": 1, "id": "1", "type": "submit_intent",
                          "payload": {"goal": "walk home", "constraints": {"steps": [{"tool": "body:move", "args": {"x": 0, "y": 64, "z": 0}}]}}})
```

## Development

```sh
python3 -m venv /workspace/.venvs/harness-py && . /workspace/.venvs/harness-py/bin/activate
pip install -e '.[dev,numen,bridge]' && pip install -e ../agent-mc-autonomy
pytest -q && ruff check src tests examples && mypy src
# Harness² (optional, Linux Python 3.12+): pinned upstream in its own venv
python3 -m venv /workspace/.venvs/harness2 && /workspace/.venvs/harness2/bin/pip install -r ../agent-mc-world/bridges/harness2/requirements.txt
python examples/harness2_run.py --out /workspace/.data/harness2-run --proposer deterministic --fresh
```
Tests use fakes at the network edge only (Numen MCP session, agent-mc-world bridge) and the real touhou-maids
`maidCommand` (node) as the argument oracle; JitRL is cross-checked numerically against the TS build; the Harness² test
runs the pinned upstream + physics practice when the harness2 venv exists.
