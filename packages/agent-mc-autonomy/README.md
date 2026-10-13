# Agent MC Autonomy

`minecraft-ai-friend` owns the complete Minecraft autonomous runtime. This optional
Python package composes the sibling `agent-mc-world` body through its public MCP
protocol. It has **no Neko, Cortico or other persona SDK dependency**. The body
package itself stays model-free; the planner is an explicitly configured port.

```text
Neko / Cortico / other Agent                 Explicit model endpoint
  personality, high-level goals, voice         standalone planner
                |                                     |
       ReviewPort / Mailbox                    Planner protocol
                +------------------+------------------+
                                   |
             agent-mc-autonomy (this package)
      useful event reviews / context budget / goal scheduling
             optional vision / rule or System One focus
                                   |
                   agent-mc-world public MCP
        sole native work queue / skills / facts / original receipts
                                   |
             Minecraft 1.21.1 server (local or remote)
```

## Run independently

Install with Python 3.11+ (`pip install ./packages/agent-mc-autonomy`). Install and
build `packages/agent-mc-world` separately following its documentation; pass the
actual built MCP entry explicitly. No private deployment or model is discovered.

Copy `standalone.example.toml` to a private configuration. Set the server/account,
an absolute shared data directory, `autonomy.enabled = true`, and an explicit
OpenAI-compatible planner endpoint/model. Keep credentials in an environment
variable named by `api_key_env`.

For the already verified compatibility body pinned to `7889ce2`, this repository
also owns its explicit build/install/verification tooling and patch set:
`python -m agent_mc_autonomy.core_distribution.build --checkout <repo> --destination <empty-dir>`;
then `python -m agent_mc_autonomy.core_distribution.install --destination <runtime-dir> --archive <tgz>`.
These commands never run implicitly. The existing `nekoBuild`/`neko-headless`
receipt field/file names remain readable for compatibility; they require no host
SDK. Moving this tooling does not upgrade the live body's pinned source.

```sh
agent-mc-autonomy check --config config.local.toml --entry /path/to/bin/minecraft-agent-mcp.mjs
agent-mc-autonomy run --config config.local.toml --entry /path/to/bin/minecraft-agent-mcp.mjs --goal "Survive safely, obtain food and prepare shelter"
agent-mc-autonomy status --config config.local.toml
agent-mc-autonomy feedback --config config.local.toml --mode insert --goal "Gather food, then resume" --request-id <uuid>
agent-mc-autonomy stop --config config.local.toml --request-id <uuid>
```

`--queue-only` invokes no model: it executes explicitly submitted native steps,
and does not pretend to plan natural-language goals. Optional image input is
declared explicitly; absent/unsupported vision falls back to textual facts. Fast
focus defaults to rules; `host` accepts an injected selector and `system_one`
uses an explicit local/remote provider, with bounded fallback to rules.

## Host adapter contract

Embedded mode calls `run_session(settings, entry, data_root, planner, goal,
publish, stopped)`. A planner implements `decide(messages, tools)` and `aclose()`;
an optional `select_fast` provides fast focus. External mode leaves this process
running and shares its account-scoped data directory with frontends. Closing a
frontend must not stop an independently launched runtime.

The native controller alone owns begin/end-turn, barriers, event cursors and
action dispatch. A host posts natural goals to `Mailbox`, never starts another
body controller for the same account. `insert` uses native safe checkpoints and
resumes prior goals; `replace` is an explicit user choice. UUIDs are durable,
uncertain dispatch blocks replay, and planner completion reports are never
treated as verified gameplay completion.

### 0.1.8: accept bounded sequential read batches

Providers may return multiple calls even when parallel calling is disabled. The
controller validates the complete response before dispatch, runs immediate reads
in order, and allows only one queued or acting tool as the final call. A failure,
stop request or native turn boundary leaves remaining calls explicitly marked as
not dispatched in model history. Native work still owns completion and queueing;
unknown outcomes still block replay.

### 0.1.7: keep the body connected during invalid planner replies

Repeated incomplete/malformed model replies have dispatched no native action.
They back off exponentially up to five minutes instead of disconnecting the
Minecraft client after the third rejection. Normal event/stop handling and
native reflexes stay alive; the next valid response clears the backoff. Exact
rejections remain in the private journal. Unknown native outcomes still stop
execution and require reconciliation rather than replay.

### 0.1.6: keep useful evidence in strategic reviews

The bounded main-brain summary retains more of the objective and inventory,
including tools previously hidden after a 70-byte prefix. It reports how long
health/inventory/food readings have been unchanged and the bounded read count.
These are observations, not a stuck verdict or a new trigger for model calls;
normal review intervals, queue ownership and optional host boundaries remain.

### 0.1.5: retain plans that did not submit work

Plain replies stay in bounded assistant history. The next dynamic tail records
that no action was dispatched from that reply, so an idle wakeup is not an
unexplained repeat of the same request. This does not force another inference,
submit a guessed action, or interrupt useful native work. The exact response
remains in the private decision journal.

### 0.1.4: retain bounded read activity across short history windows

The dynamic request tail includes successful read-call counts since the last
accepted body action in this runtime. Evicting old exchanges no longer hides a
long sequence of observations. Counts are bounded, do not establish a stall or
goal success, and do not block reads or script actions. Rejected actions do not
reset them. The planner still selects work from current evidence.

### 0.1.3: keep evidence instead of internal fact hashes

Model-visible facts omit internal revision hashes so they cannot crowd out the
latest action result. Original handles and full persisted observations remain
unchanged; stable instructions still precede the fresh state at the request tail.

### 0.1.2: preserve orientation and the standing objective

Ray previews retain the eye frame, measured world direction and native geometry
semantics. Relative pitch/yaw alone cannot describe where the player looked,
especially after mining overhead. Full receipts remain available by handle.
A submitted stage retains the standing objective as context while explicitly
keeping the stage's priority. The planner reports observed stage completion to
resume the standing goal; this remains an unverified report, not auto-completion.

### 0.1.1: invalid tool calls keep the body connected

Malformed arguments, unadvertised tool names, multiple simultaneous calls and
attempts to cross the controller's turn boundary are rejected before dispatch.
The exact model reply and a `dispatched: false` diagnostic remain in the private
decision journal. A correction notice goes at the next request's dynamic tail;
repeated invalid calls back off up to 60 seconds. The controller does not silently
reroute an unadvertised call or disconnect the player for this planning error.
Unknown native outcomes still block replay and require receipt reconciliation.

The optional strategic loop belongs here as well:

```python
from agent_mc_autonomy.review import ReviewPolicy, ReviewPort

reviews = ReviewPort(account_host_directory)
reviews.configure(ReviewPolicy(enabled=True))
envelope = reviews.offer()  # transport this to a persona; never call observe here
if envelope["offered"]:
    review = envelope["review"]
    # Send review['summary'] and its ID with your host's public API.
    # Afterwards record transport acceptance, not decision/playback success:
    reviews.delivered(review["id"], accepted=True)
    # The actual host decision calls one of:
    reviews.decide(review["id"], "inspect")
    reviews.decide(review["id"], "continue", reason="Current native work is progressing")
    # Or insert one concrete stage goal. Never automatically replace ongoing work.
```

Only runtime publication creates reviews. Material changes and terminal task
results trigger bounded reviews, repeated successful looks do not count as
progress, and periodic review continues without audience chat. Death/runtime
failure can supersede an ordinary request. Current body/inventory/food/goal/queue
and original-query access remain useful; no accumulating prompt transcript or
separate summarizing model call is added. Stable planning instructions precede
dynamic facts at the request tail.

Review IDs, retries and results live in SQLite. Freshness/session/intent fences
reject late decisions after new user feedback. Two delivery attempts per review
and backoff bound unanswered requests. A lost acknowledgement is reconciled with
the durable goal mailbox. Optional review storage failure cannot kill gameplay.
The strategic port is disabled by default and never starts a stopped runtime.

Viewer assembly uses the body's public extension ports and an explicitly
installed `mc-visual-console` checkout/catalog. Rendering code and assets remain
in that separate project. No viewer, speech engine or server is bundled here.

## Verification and source

Run `python -m pytest -q` here. Tests deny host SDK imports, network and service
launches; the isolated process test exercises both a fake autonomous planner and
queue-only operation. These tests do not prove live survival, actual model
capability, voice playback or all possible host integrations. Cortico integration
is supported by the neutral ports, not claimed as a shipped/tested adapter.

The initial runtime was extracted from the user's autonomous plugin at
`jcs130/n.e.k.o_plugin_minecraft_autonomous@581e65b`. Its Apache-2.0 license is
preserved in this package. The sibling body retains its own license. The Neko
plugin now consumes this package at a fixed commit; it must not carry a second
copy of the controller, context policy or review scheduler.
