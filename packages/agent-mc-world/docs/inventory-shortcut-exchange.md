# Cursor-free sorting exchanges

Core rc.124 uses native number-key exchanges for sorting swaps only when the
caller explicitly includes player shortcuts (`organize`, `includeHotbar:true`)
and the backend declares modern state-ID inventory confirmation. A direct
shortcut exchange takes one click; two ordinary slots use three exchanges
through an included shortcut. Armor, offhand and container storage are not
borrowed. Default protected-shortcut sorting and stack merging keep their
existing behavior.

The public `planInventoryShortcutExchange` SDK/extension helper proposes bounded
exchanges inside the supplied range. The executor revalidates every participant,
components, counts, empty cursor and exact window before dispatch and after each
authoritative result. An acknowledged partial exchange remains partial on
cancellation; an unknown result is never retried or undone automatically.

The offline reproduction fills the player bag, then simulates an external pickup
into a source slot temporarily emptied by the old cursor-based sorting. It
reproduces the reported occupied-return-slot error with bone x3 carried. This
demonstrates a possible race, not proof that a pickup caused Yui's live incident.
The new swap path avoids that transient cursor and free slot in a full bag.
Existing live carried items still require separate reconciliation; this change
does not clear, drop, replay or invent the outcome of an old transaction.
