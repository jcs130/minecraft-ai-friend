# Local episodic candidate ranking (JitRL)

The existing game notebook exposes `action:experience` operations `policy_help`,
`rank`, `feedback` and `policy_status`. SDK, MCP and direct World hosts share the
same implementation. Read `policy_help` for the executable contract. It performs
no inference, body dispatch, automatic exploration or skill adoption. `rank`
requires fresh current observations; historical feedback/status can be read offline.

## Research and implementation provenance

Primary sources: [JitRL v4](https://arxiv.org/html/2601.18510v4),
[author implementation](https://github.com/liushiliushi/JitRL/tree/143d22185d95fbf633a0befe6861d5e8b732543b).
Reviewed both WebArena/memory_agents/jitrl_agent.py and Jericho/src/jitrl_agent.py,
including retrieval, action grounding, return aggregation and candidate scoring.

The paper estimates V as the mean retrieved return, Q as the mean for an action,
then A=Q−V and softmax(log(prior)+beta*normalized A). Our independent implementation
uses that formula. The reviewed WebArena code at line 378 adds advantage to a
variable named normalized_prob (set from exp(logprob) or confidence/100 around
lines 1032/1053). Those are different calculations; the probability-space addition
is deliberately not copied. Tests check the log-space equation numerically.

## Adaptation to a live, partially observed game

- This initial release treats one bounded action segment as a one-step return.
  It does not reconstruct the paper's multi-step discounted return from unrelated
  operations, or run its retrospective LLM reward judge. Before execution the
  caller selects a measurable food, health, item-count or distance-progress
  criterion. The return is clipped delta/target minus observed health-loss penalty.
  This is local progress, not goal success; distance can improve on a bad route.
- Candidate priors are explicitly caller-declared and not calibrated success
  probabilities. A host can reuse an existing typed decision distribution; `_choose`
  now preserves its complete distribution, including `_inspect`, for audit.
- Retrieval is conservative structured matching: realm/account/agent, actual
  dimension, stable task/phase, explicit condition metadata and exact action
  fingerprints; nearby position, food and health rank the neighbours. Versioned
  method handles are recommended. A changed method cannot inherit its parent's
  feedback. The caller still checks readiness and changes to unobserved terrain.
- Up to 10 neighbours from the last 1024 feedback entries (at most 30 days old),
  beta=0.5, max-absolute-advantage normalization. Missing-action advantage is zero;
  one action alone cannot establish a relative advantage. No random optimistic
  exploration. These are conservative integration settings, not claimed optimal
  Minecraft hyperparameters.
- Same-scope terminal receipts must match the proposed tool/arguments and the
  pre-execution snapshot. Dispatch must start within 30 seconds of rank. The
  terminal may arrive later. Repeated request/task feedback cannot add samples;
  pending results remain pending and missing/cancelled results remain null.
- Rank retries preserve their original expiry. A stale result does not authorize
  a replay. Archived records survive index eviction and process restart; recent
  retrieval is bounded and synchronous, with atomic index replacement.

## Memory, privacy and evaluation

Metadata lives below `minecraft-memory/jitrl/<scope hash>`. Proposed arguments and
code are hashed and discarded; records retain numeric observations, IDs, candidate
probabilities and evidence references. They contain no prompt, answer, reasoning,
chat or credentials. The notebook's existing explicit `reflect` operation can
create an attributed lesson using original operation IDs; personal host memory
retains only useful conclusions and pointers on demand.

The tested sequence is rank → real operation collector → terminal → feedback →
restart → rank, using the production memory service. Independent held-out decisions
are evaluated after both positive and negative examples; scope, readiness, stale
state, cancellation, exact arguments and duplicate execution identities are checked.
This mechanism test does not establish live goal success or causal improvement.
Do not reuse a held-out decision's future return as its own retrieved experience.

Rollback: load the previous core/Bot/World package set. This feature adds no timer
or configuration migration; its separate metadata folder can remain in place.
Original operation records and personal memory are not rewritten.
