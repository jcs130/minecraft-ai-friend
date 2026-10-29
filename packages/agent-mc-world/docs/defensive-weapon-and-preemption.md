# Defensive weapon choice and task terminals

An automatic encounter keeps a bow or crossbow that is already equipped and
currently ready. Merely owning a bow or describing a future plan does not select
it. Readiness is checked on subsequent ticks; empty melee hands do not supersede
a ready ranged weapon. Without that initial equipped choice, existing hybrid
distance hysteresis remains in use. Health, terrain, enemy eligibility and
retreat gates still apply. Explicit attack tasks own their mode independently.

`agent-mc-world/client` exports `createDefensiveWeaponSelector` and
`DefensiveWeaponFrame` for thin hosts that retain their own combat body. Create
one selector per body, call `phase: 'start'` at each encounter, then `phase: 'tick'`
with current readiness and distance. The selector neither equips a weapon nor
sends input, commands or model requests. It does not choose profession spells,
write a tactic or promote a learned method.

Safety preemption emits a terminal for every accepted task removed from the
native queue, including suspended continuations. The primary notice remains
`superseded`; additional tasks receive their own `cancelled` receipt with their
original ID and partial-step evidence. They are not reported completed. This
prevents cleared queue entries remaining indefinitely accepted in SDK/MCP
execution state.

The regression uses the real executor, World terminal projection and standalone
SDK registry, both with running work and with the queue held by another body
owner. Every original task gets exactly one terminal, no queued chat is sent,
and no goal is called complete. Existing historical admissions without a
terminal are not silently repaired, replayed or discarded by this change;
recovery requires their original native evidence.
