# Completed Chat Reasoning Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let explicitly compatible Chat providers omit reasoning from completed user turns while preserving current tool continuations, original journals and every public message/tool result.

**Architecture:** Add a provider-neutral `reasoning_history` setting with `all` as the compatible default and `current_turn` as an explicit Chat-only choice. Apply the choice only in the Chat wire encoder; no controller state, stored provider replay or other protocol is rewritten. The request counter must consume exactly the same projected wire request.

**Tech Stack:** Python 3.11+, existing dataclasses/config parser, pytest and local packed-consumer checks.

**Spec:** `packages/agent-mc-autonomy/AGENTS.md`, the preservation and opt-in contract in this document.

## Global Constraints

- Preserve explicit start/stop, unknown-dispatch blocking, intent UUIDs and user-feedback priority.
- Never import Neko, Cortico or the server project.
- Tests use temporary state and fake model/body ports with network/processes prohibited.
- Existing configurations and signed/encrypted replay protocols keep their current behavior.
- Do not reduce the configured 131072-token window or remove persona, memories, conversation or body results.
- No changes or restart of Neko main/SDK, the healthy model service, or the Minecraft server.

## Review Focus

- A current user → assistant tool call → tool result continuation must retain that assistant's reasoning.
- A later user query must not replay earlier reasoning when the new option is explicitly chosen.
- Missing or foreign provider scope must not leak replay data into a different connection.
- Explicit false/null/list values and non-Chat use must fail configuration validation.
- Default wire bodies and original mutable input objects must stay identical to current behavior.

## Task 1: Config and Chat encoder contract

**Files:** Modify `packages/agent-mc-autonomy/src/agent_mc_autonomy/model_config.py` and `model_protocols.py`; create `tests/test_reasoning_history.py` in that package; update its README/version.

**Interfaces:** `HttpPlannerConfig.reasoning_history: str = "all"`; accepted values `all|current_turn`. `request(config,messages,tools,budget)` keeps its signature and returns the usual wire request.

- [ ] Add a failing test using this exact boundary:

```python
config = HttpPlannerConfig.parse({"base_url": "http://localhost:1/v1", "model": "fixture", "reasoning_history": "current_turn"})
messages = [{"role":"user","content":"old"},
            {"role":"assistant","content":"old answer","_provider_state":{"scope":scope(config),"data":{"reasoning_content":"old reasoning"}}},
            {"role":"user","content":"new"},
            {"role":"assistant","content":None,"tool_calls":[{"id":"call-1","type":"function","function":{"name":"read","arguments":"{}"}}],
             "_provider_state":{"scope":scope(config),"data":{"reasoning_content":"current reasoning"}}},
            {"role":"tool","tool_call_id":"call-1","content":"original result"}]
body = request(config,messages,[],1024)[1]
assert "reasoning_content" not in body["messages"][1]
assert body["messages"][3]["reasoning_content"] == "current reasoning"
```

- [ ] Run `pytest tests/test_reasoning_history.py -q` and retain the expected red result.
- [ ] Add the string field at the end of the existing dataclass to preserve positional callers. Validate both the allowed enum and Chat-only opt-in in parser/budget validation. In the Chat encoder, find the last user-message index; include native reasoning only in `all` mode or for assistant messages after that index. Do not send the local policy field to the provider.
- [ ] Add parameterized invalid configurations, unchanged default, no-user/current continuation, foreign scope, and exact input immutability tests.
- [ ] Run the full package suite and Ruff on changed Python files; record existing unrelated whole-tree failures separately.
- [ ] Build an exact committed wheel and run the codec/config tests from an isolated installed consumer before committing the adapter pin.
- [ ] Update the README with opt-in limitations and bump the package patch version. Fetch and use an ordinary main push after checking the staged diff.

## Task 2: Pinned consumer and scoped live verification

**Files:** Update only the adapter dependency pin, version, changelog and associated pin expectations. Private comparison/config/deployment proofs stay outside source control.

**Interfaces:** The adapter consumes the new exact source revision and wheel hash. Current runtime Settings identity remains the authority for ownership and deployment.

- [ ] Fetch adapter main, preserve other changes, build its candidate, run pytest/Ruff/official release-structure checks and inspect package contents.
- [ ] Use the same frozen real exchanges to verify equal public wire fields and exact-tokenizer input savings. This is an encoding measurement, not a gameplay-quality or latency claim.
- [ ] Request normal drain of the freshly resolved owned executor, verify terminal/unknown work and lease release, then replace only that executor's pinned runtime.
- [ ] Add only `planner.reasoning_history="current_turn"` in the private local configuration. Preserve every other value and rebind the exact counter to the new configuration.
- [ ] Validate actual current model responses and native inventory/position changes, natural voice and protected-process continuity. Explicitly distinguish a short fresh-session observation from sustained/full-window acceptance.
- [ ] Record commits, package/check/deployment evidence and remaining latency/publication limitations; finish without a release tag or Market submission.
