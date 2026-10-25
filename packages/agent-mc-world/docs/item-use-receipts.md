# Item-use receipts

Java 1.21.1 remains the primary target. The native packet guard checks the selected
item and cancellation immediately before the use packet is sent. A hand change at
that boundary prevents the packet and retains the existing blocked receipt.

After a confirmed local send, a server response can change components, replace an
item or consume it. That later change cannot be reported as "not sent". Generic
item use observes the resulting inventory/window and does not release use on a
replacement hand, re-equip the original item or replay the activation. An observed
inventory change or sent packet alone still does not verify the intended goal.

Planner body facts read maximum health from native attributes and modifiers, using
the same reader as battlefield observations. An unobserved maximum stays unknown;
legacy snapshot producers that omit the optional field retain their prior 20-point
format. No server-specific channel, model, host or permission rule is added.

## Composter interactions

Using a crop item on an observed composter is a block interaction, rather than
planting on soil. Both admission and execution retain the requested block. The
receipt reads the composter's `level`, the offered item's inventory count, and
the bone-meal count separately. A consumed seed can fail to increase the level;
neither consumption nor a level increase proves bone-meal output. An unreadable
target, or an unchanged target with no inventory effect, is not confirmed success.
