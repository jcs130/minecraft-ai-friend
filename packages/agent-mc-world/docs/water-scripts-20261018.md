# Mineflayer water-script review

Base: main `2161c79a` / core 0.5.7-rc.16. The changes are generic core behavior and on-demand guides, without changing the host framework or injecting a fixed activity into an agent.

The combined 0.5.7-rc.18 candidate also integrates upstream `b9e152db` (optional final-target motor training and isolated simulation). Its new backend is opt-in; this water review does not start training, launch a server, or activate a motor policy for the live agent.

## Findings and corrections

| Finding | Correction | Evidence |
| --- | --- | --- |
| `control(mode:water)` rejected non-jump input at oxygen <= 6 even with anti-drowning disabled. | Remove this independent numeric veto. Report measured oxygen, health, received damage and update time. The script chooses the next segment; configured environment takeover still has its own contract. | Actual Prismarine water physics, low-oxygen control and explicit ascent tests. |
| Repeated `installTreadWater` calls could retain competing enable callbacks and physics listeners. | One controller per bot, update its callback on reinstallation, disposable connection resource, release only its own input. | Repeated installation, disconnect and newer native input ownership tests. |
| Head wetness used feet + 1 block. Surface breathing and shallow fluid levels were misclassified. | Use current eye height and loaded fluid geometry, including continued water columns. Unknown block/fluid coverage remains null in the breathing readout. Default standing eye height is labelled. | Java 1.21.1 and 1.20.6, source/shallow water and unknown coverage tests. |
| The budget reference could use older valid rate pairs after a newer realm/epoch or another dive segment. | Only the latest continuous segment, with fresh sample/oxygen timestamps and the same observation identity, is comparable. Refills and dry boundaries restart estimates. | Actual isolated Worker computations on positive and negative examples. |

`observationId` belongs to this sensor installation; reconnect/reinstallation changes it. `observationEpoch` increments on respawn within that installation. An entity number and epoch alone cannot identify a connection.

Water control uses observation-only sampling after its sensor is installed, so disconnect cleanup cannot reattach old listeners. Damage from a different observation identity/epoch is reported as unknown, never a negative damage amount.

## Agent-authored methods

Read `mc_script {"api":"diving"}` first; request `api:"diving-budget"` only when implementing or revising that calculation. It returns reviewable maintainer-authored source, not a learned procedure or an automatic movement policy. `examples/adaptive-diving.mjs` exports the same source.

The reference takes current `bot.read("breathing")` samples, measured `returnSeconds`, caller-selected `reserveSeconds`, `minHealth`, and `sampleMaxAgeMs`. `nowMs` is only an offline replay override. It returns a proposal with `goalCompleted:false`; invalid/stale evidence yields `observe`. Remaining air discounts time since the last received oxygen update. A measured health loss can shorten the return margin; healing cannot erase received damage or extend oxygen.

Actual controls remain native key input under the existing executor lease. Cancel, disconnect, death and server correction release the originating input. Positions, velocities, gravity and collision rules are not altered to simulate swimming. The opt-in `reflex.antiDrown` configuration still governs passive floating and the separate emergency supervisor; water control has no additional fixed-oxygen gate.

The current pathfinder does not implement a general descending underwater planner. A failed `goto` is not evidence of an impassable water shaft. Check local geometry and measured movement; use explicit bounded water input or revise the route. Pressing jump or completing a script is not proof of reaching a breathing point or dry land.

## Upstream basis and limits

Mineflayer describes `setControlState` as key-like movement input and oxygen as a 0–20 reading: [official API](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md#botsetcontrolstatecontrol-state), [oxygen](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md#botoxygenlevel).

The installed Prismarine physics 1.11.1 applies upward input in water and horizontal slowdown for sneak; looking downward does not implement a dedicated pitch-driven dive. Fluid levels follow the source/falling and flowing water semantics in [upstream physics](https://github.com/PrismarineJS/prismarine-physics/blob/master/index.js). The package retains that physics rather than claiming Java swim-pose parity.

Tests and simulation do not establish a live route, a safe return duration, autonomous learning, or long-term navigation improvement. Those need actual method selection, execution terminals, world changes and later retrieval/reuse evidence after authorized loading.
