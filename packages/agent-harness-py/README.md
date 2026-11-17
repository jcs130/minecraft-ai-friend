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

## Native private companions

`MaidBody` also accepts `NativeMaidBridge` from `agent_mc_harness.bridges`. Install the
`native-maid` extra for this transport. It binds an existing private companion through the server's
authenticated loopback `/maid-body` endpoint, including when the owner has no client connection.
The Java endpoint must be enabled and authorize this exact owner/body pair before binding.

```python
from pathlib import Path
from uuid import uuid4

from agent_mc_harness import BodyAction, Scope
from agent_mc_harness.body.maid import MaidBody
from agent_mc_harness.bridges import NativeMaidBridge

# cfg comes from the host's private configuration and retains the original identity and memory scope.
bridge = NativeMaidBridge(
    cfg["endpoint"], Path(cfg["tokenFile"]).read_text(encoding="utf-8").strip(),
    owner_id=cfg["ownerId"], maid_id=cfg["maidId"], controller_id=str(uuid4()),
)
body = MaidBody(bridge, scope=Scope(**cfg["scope"]), owner_id=cfg["ownerId"], maid_id=cfg["maidId"],
                server_id=cfg["serverId"], world_key=cfg["worldKey"])
try:
    await body.spawn()
    snapshot = await body.snapshot()
    # The host retains request_id before sending. Check capabilities() for supported verbs.
    receipt = await body.act(BodyAction(verb="move", args=destination, request_id=request_id))
    if receipt.status in {"accepted", "unknown"}:
        receipt = await body.result(request_id)
finally:
    await body.destroy()
```

`bind`, `call`, and `release` exchange `qiandengji-maid-body/v1` envelopes containing the configured
`ownerId`, `maidId`, `controllerId`, and a server `generation`. Calls and release carry that generation.
`call` accepts `name: mc_maids` and `arguments`; writes also carry matching outer and inner `requestId`.
Its `result` is an MCP CallToolResult with the existing maid reply in text content. The server advertises
the live `mc_maids` schema during bind. `move` is available only when it advertises `walk(x,y,z)`.
Body kind remains `maid`, preserving the configured memory partition across transports and dimensions.
Existing companions still need an explicit mapping to their original conversation history and PowerContext
namespace. Reusing the body UUID alone does not migrate an existing brain or its memories.

`result(original_id)` queries the server after process recreation, even when this adapter has no local
receipt. It validates the original operation, action and body association before accepting a terminal
result. Historical unknowns remain queryable. An authorization failure, control-conflict response or mismatched identity/generation fences the
bridge; its host must arrange an explicit control handoff. The adapter never automatically rebinds after
that fence. Release failure is reported so the host can inspect control before starting a replacement.
An original-request conflict remains unknown until the server's original receipt is queried; a local rejection
must not hide that receipt. Missing or mismatched action identifiers cannot prove successful execution.

The native endpoint reuses the private companion executor. Its supplied action catalogue determines
equipment, follow and other available operations. Public-resident registration and owner inventory
transfers have separate implementation and authorization requirements.

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
