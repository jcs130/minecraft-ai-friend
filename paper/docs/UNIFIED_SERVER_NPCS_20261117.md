# Unified Numen / TLM NPC candidate, 2026-11-17

This candidate follows the owner's choice: Kirito uses a Numen body; the new
healer Yui uses TLM; Feiyu retains the original TLM identity. They share one
planner/runtime/body contract and server memory service. See the
[architecture and migration instructions](../integrations/unified-npc/README.md).

**Production NPC migration is not yet complete.** A running synthetic supervisor,
container or successful model reply is not production character acceptance.
The deployment manifest must be written only after actual loading and readback.

## Evidence so far

Artifacts are in the operator workspace `artifacts/npc-joint-release-20261117`.
Tests use synthetic UUIDs starting `10000000-` and independent loopback ports.
They do not mutate Feiyu, Kirito or player inventories.

| Evidence | Observed result |
|---|---|
| `unit-regression.xml` | 133 passed, 3 pre-existing conditional skips; graph dependency emits one Pydantic deprecation warning |
| `unified-healer-stage.json` | 12 checks, including Coding Plan Qwen real single/group healing and Token Plan fast guard selection |
| `unified-guard-stage.json` | 6 checks: guard survives scheduling, cast resumes guard only at the original terminal receipt, stay stops it |
| `combined-admit.json` | Same-UUID TLM→Numen admission, original equipment and migration health verified |
| `combined-heal-stage.json` | Real TLM healer affected the migrated Numen body, not a replacement entity |
| `hosted-combat-stage.json` | 7 checks: native no-dig/no-place permissions, real equipped sword, Qwen-selected attack, actual enemy damage and original task terminal |
| `supervisor-stage/acceptance.json` | Each of two bodies completed five consecutive scheduled turns without a new failed or unknown action |
| `graphiti-http-stage.json` | 8 checks: HTTP authentication, durable offline outbox/restart, idempotency, conflict refusal, real recall and role isolation |
| `cold-restart-failure.json` → `cold-restart-check.json` | Before: saved 23 HP became 20 at login; after: original 23 HP, UUID, items/components and committed migration phase all preserved |
| `deepseek-route-stage.json` | Token Plan DeepSeek V4.1 Flash returned a valid plan and completed a real native-maid read through the same executor |

Another regression first reproduced a repeated Numen reply to an already
delivered event. Consuming the original completed dialogue receipt stops that
loop; an uncertain speech result is not silently acknowledged or resent.

## Fixes required by real integration

* A hosted-managed Numen body rejects ordinary Lua calls. The new transport uses
  `hosted_body`, its actual lease/epoch, persisted original IDs and native inbox.
* Youer's ProtocolLib join hook required the fake connection's in-memory codec
  pipeline before player admission. The bridge initializes it only for Numen.
* Better Combat resets swing charge before the later damage callback. The bridge
  retains the current swing's charge and executes its real upswing on the game
  thread; tested enemies receive measured damage.
* RPG attributes become available after fake-player login. Original migration
  health and later saved health are separately handled; new damage blocks delayed
  restoration, and completed migration never reuses old full health on restart.
* Native maid planners are persistently fenced for explicitly unified bindings,
  even if an external lease expires. Native physical tasks remain available.

## Remaining release gates

Freeze source and candidate hashes, pass CI, take current F-only cold backup,
migrate/read back original Kirito, register Yui once and verify the original
Feiyu with her new model route. Install the independent supervisor lifecycle;
then check real observation, conversation, actions, YSM and service coexistence.
NeoForge animation pixels, Bedrock appearance, real speech listening and
long-running multi-character behaviour require their own evidence. Short
synthetic loops do not establish those claims.

PR #287's resident-only swordsman candidate cannot be applied unchanged to the
new Numen body. PR #279 and #256 are separate gameplay candidates, not silently
included in these three native body artifacts. Existing classic Numen API
consumers also prevent blindly deleting that older runtime.
