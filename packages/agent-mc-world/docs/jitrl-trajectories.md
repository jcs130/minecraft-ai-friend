# Completed-trajectory JitRL

The previous `experience/rank` + `feedback` API measures a **single operation's immediate delta**. It remains compatible, but is not the multi-step evaluator described in JitRL. The new `agent-mc-trajectory/v1` protocol retains completed task trajectories, step rewards, future returns, scoring revisions and actual reuse receipts. It performs no model inference, body actions, autonomous exploration or weight training.

## Evidence and credit

1. Bind the original objective and revision **before** actions with `trajectory_begin`. Include scope-owned task/assignment identity, scene conditions, optional method revision and a native metric when available.
2. Append original `meta.experience.id` values with `trajectory_append`. Native physical task identities are deduplicated; chronology, realm/account/agent and run are checked. Tool acceptance is not a terminal.
3. `trajectory_close` freezes at least two original operations after native terminals. Cancellation and unknown effects remain unknown. A model's `completed` label never sets `goalVerified`.
4. A host-owned background evaluator reads every page using `trajectory_get` and proposes **one reward per original step** through `trajectory_score`. Its explanation is an attributed estimate; native whole-trajectory net change is retained separately.
5. A separate review can revise rewards using the prior scoring version. `trajectory_review` explicitly adopts one complete version or withdraws it. Old score versions remain auditable and never count as additional physical samples. Unknown returns cannot be adopted. Positive initial credit conflicting with a measured nonpositive objective is rejected.
6. For the same objective identity/revision and comparable current scene, `trajectory_rank` applies adopted multi-step returns to explicitly supplied candidate priors. `trajectory_use` links an actual later operation to that decision. A ranking change or completed tool alone does not prove improvement; compare the new complete trajectory and native outcome.

The return is `G[t] = r[t] + gamma * G[t+1]`. Both raw cumulative return and a geometric-normalized value are stored. The normalized value fits the existing bounded `log(prior) + beta * advantage` update without erasing the raw return. Unknown rewards propagate backwards; they are not silently replaced with zero. Untried candidates retain an explicit unknown Q and a neutral computational estimate, not an invented successful outcome.

The caller supplies real candidate arguments and readiness; this layer does not invent a combat policy or override safety/controller ownership. A new script/method revision changes its action hash. Decisions expire after 30 seconds and replay keeps the original timestamp; the original action is never replayed to obtain a missing receipt.

## Retrieval and integration

Use the declared tool capability `trajectoryLearning.protocol`, not a host-specific tool name. The notebook's `action:experience,operation:trajectory_help` provides exact contracts. These operations are also exported through `agent-mc-world/learning` and available through the normal SDK/MCP tool surface.

The index contains only bounded metadata. List does not expand trajectories. Recall reads at most three matching episodes; rank reads at most eight matching episodes and uses at most 32 distinct physical samples. Full evidence is paged. Only a short relevant projection belongs in an execution request; it must not be appended permanently to the personality prefix.

Hosts should collect IDs automatically, reconcile native terminals, and schedule scoring/review on the existing background learning queue. Failed optional collection must not change a returned action to unknown, block the body queue, or repeatedly request a model without new evidence. Historical instructions must never retroactively change the bound objective. The host remains responsible for model choice, request provenance, task boundaries, evaluating evidence, and adopting methods.

## Evidence limits and tests

The regression fixture exercises delayed credit, take/return cancellation of gains, scoring revision replacement, a new counterexample, changed action ranking, actual reuse binding, interrupted runs, pending terminals, pagination, restart, stale decisions and identity/version isolation. These are deterministic protocol/algorithm results, not claims of improved live survival or learned game skill. A valid live claim additionally needs a newly completed trajectory, reviewed score, later retrieval/use, and a measured improvement under comparable conditions.

## Research basis

- [JitRL paper, v4, 2026-09-27](https://arxiv.org/html/2601.18510v4), sections 4.1–4.3: completed trajectory evaluation, stepwise rewards, discounted return and retrieval-conditioned policy adjustment.
- [Original agent at fixed commit 143d221](https://github.com/liushiliushi/JitRL/blob/143d22185d95fbf633a0befe6861d5e8b732543b/Jericho/src/jitrl_agent.py).
- [Original cross-episode memory at the same commit](https://github.com/liushiliushi/JitRL/blob/143d22185d95fbf633a0befe6861d5e8b732543b/Jericho/src/cross_episode_memory.py).

Scoring-revision audit and two-pass host review are engineering extensions; the paper's cross-episode iteration does not require repeatedly rescoring an unchanged episode. This implementation uses explicit bounded state matching and exact action hashes, rather than claiming reproduction of the paper's embedding retrieval or benchmark results.
