# Mineflayer-shaped control for both bodies

Java 1.21.1 is the primary target. Mineflayer remains the default protocol client. An explicitly attached real Java client is another body behind the **same shared JavaScript method worker**, not a new language for the Agent.

```text
Agent / personal memory / selected immutable method
                    |
          mc_script: bot + Vec3 + goals + mc
                    |
      shared SES worker, receipts and method versions
             /                        \
Mineflayer public methods       Java body adapter
             |                        |
Mineflayer connection          authenticated local Fabric bridge
             |                        |
Minecraft server              actual Java client connection
```

The Java adapter does not create a second Mineflayer login. The real client owns its connection, renderer, mod state, inventory and physics. Adapting a public method is different from replaying network packets or injecting operating-system input.

## Reuse contract

- Use one method source and immutable source hash for both bodies. `bot.look` uses radians, positions revive as `Vec3`, block snapshots expose synchronous `getProperties()`, and inventory uses common player slot conventions. Every transported `bot` call requires `await`; synchronous `bot.entity` access is outside this sandbox.
- `await mc.capabilities()` returns `minecraft-method-capabilities/v1`: actual supported `botMethods`, `mcMethods`, backend and step-group scope. Check required methods before the first body call. Java capabilities are the intersection of the actual bridge advertisement and methods implemented by this core. Future or unknown bridge names do not become callable automatically.
- The method names and capability projection share `core/method-capabilities.ts`. The Mineflayer guide must cover that complete method surface; the Java adapter declares its supported subset. Method availability does not remove backend-specific reach, visibility, slot, navigation or cancellation rules.
- `examples/portable-method.mjs` contains an unchanged, read-only-by-default method for both workers. Optional `params.look={yaw,pitch}` explicitly enables one view action; it never declares task completion. Cross-body tests compare its source hash and actual method trace.
- Keep shared skills, method versions, conditions, observation checks and learning evidence in this core. Host personality, decisions, models and personal memories remain in the host. A learned method may be imported without source rewriting, but account-specific data never migrates automatically. Link immutable versions and actual receipts when recording its applicability.
- Low-level native `operation/input` remains an escape hatch for a currently unsupported, documented interaction. It must not become the default skill format or require the Agent to invent a separate set of mouse/keyboard recipes.

## Current limits are explicit

| Layer | Mineflayer body | Real Java body |
| --- | --- | --- |
| Worker, `bot`/`Vec3`/goals, method library and version format | Shared | Shared |
| Reads, view, control keys, actual-tick waits, main-hand item use | Supported public method subset | Capability-gated subset |
| Block search, hotbar, storage equip, walking navigation | Existing core support | Requires matching bridge methods; navigation additionally requires optional Baritone |
| High-level `mc.do` | Core skill groups, dependencies and expectations | One supported legacy step; broader groups are still a gap |
| Digging, placing, armor/offhand equip, arbitrary plugins/events | Existing core methods where exposed | Not yet projected; reject explicitly |
| Independent fast combat and survival reflexes | Existing core implementation | Not yet brought to parity; do not advertise automatic protection |

Arbitrary third-party Mineflayer plugins depend on events, synchronous state, physics or protocol internals and cannot be assumed compatible merely because some public methods match. Future work should extend this body adapter and shared evidence checks rather than fork the Agent's skill language. Preserve the existing single body queue, lease, original action IDs and cancellation cleanup; an unknown effect is never automatically replayed.

Reference: [Mineflayer public API](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md), [native bridge and attachment](java-client.md).
