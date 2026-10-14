# Existing native client optimization — 2026-10-15

This work continues the existing **Fabric 1.20.6 / Minescript 4.0** body. It does not upgrade Minescript, replace the host brain or move the active connection. The live client's identity, original goals, memory and both ledgers are retained. No service was restarted for this work.

## Findings and changes

| Observed problem | Change | Evidence / boundary |
| --- | --- | --- |
| Sequential Python `getblock` scans time out; a real ten-block probe measured 33.66 ms per call | Optional owned `skills/java-client/agent_mc.py` batches at most 256 positions per `getblocklist` | Real 845-block read took 0.104 s; native action from admission to terminal took 0.766 s. This was a read, not harvesting or task completion. |
| Agent guesses dictionary block returns, `minescript.sleep`, or old provider APIs | Focused versioned `mc_script` help pages; Python helper returns structured signatures, examples, exact output fields and budgets | `agent_mc.help('scan_blocks')` actually returned through the live body in 0.584 s. No game/network/model calls occur when reading this helper documentation. |
| Missing optional `language` passes the schema but fails the handler | Default the only supported language to Python; reject explicitly unsupported languages | SDK/MCP regression tests preserve the original native action ID and terminal/turn semantics. |
| `mc_help(skill)` repeats the complete manual instead of the requested operation | Return the discovered operation's exact input format plus short receipt rules | Unsupported operations remain explicit failures. No synthetic navigation or skill implementation is advertised. |
| Every frame/receipt repeats 100 past actions | Keep pending work and four latest historical summaries, with total/pending/unknown/omitted counts | On one actual snapshot, compact text fell from 15,086 to 7,813 characters (48.2%). This is a candidate serialization measurement, not a live LLM latency claim. Full original evidence and `mc_queue` remain queryable. |

The helper returns absolute coordinates using floor for negative positions, raw block strings, parsed properties, observation times and explicit truncation. `void_air` is marked void/unloaded, incomplete batches fail, and no new chunks are requested. Import does not execute anything. Python remains trusted local code, not a sandbox.

## Validation and artifacts

- Independent build and public declarations: passed; 11,141 runtime files and 277 declaration files, without extracting a framework checkout or downloading during the build.
- Full core suite: 95 files / 741 tests passed; typecheck and release verification passed.
- Optional Python helper: five offline tests passed, covering batch count, negative positions/properties, budget rejection before game reads, incomplete/unknown observations, bounded waits and documentation discovery.
- Packed consumer without Cortico installed: SDK/MCP focused help parity, explicit turns, acceptance versus completion, wait cancellation, stop without revival and denied outbound network/process calls passed. NodeNext public type consumption passed.
- Local core candidate: `agent-mc-world-0.4.2.tgz`; SHA256 `8500fa350cb1f77d4d1756c3de22f9d62276912cfc5a0cdbd909b6776e49d8cd`. This is not an npm publication.

Initial fresh validation copies lacked a new dependency link, generated runtime files and nested vendored declaration `dist` directories. Those failed runs remain in local validation history. After preparing complete inputs and building before tests, the full final gates passed; failures were not waived.

## Deployed versus pending

The helper module and a reference document were installed in the existing client/host workspace without restarting either. The Agent actually imported the helper, scanned blocks and read structured help. Private original runtime receipts remain local; they are not source or distribution assets.

The new core help/default-language/receipt compaction and the server adapter's message-index patch are **built and tested, but not loaded into the active World**. The current body/connection remains running. Activation must preserve the current viewer mode: the active older bridge does not implement the newer visual-data export, so this patch is not authorization to switch its viewer to data mode.

Gameplay is not yet fluent. The Agent has moved, used menus and exchanged messages, but repeatedly used outdated or guessed script APIs and attempted oversized scans after the guided test. At the final observation it remained inside a small mountain house and had not demonstrated a reliable exit/flight/navigation sequence. The guided block read is not proof of autonomous exploration, combat or harvesting. Those effects require separate native execution and observation acceptance.

Pinned primary API reference: [Minescript 4.0](https://github.com/maxuser0/minescript/blob/main/docs/v4.0/README.md).
