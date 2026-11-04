# Explicit combat target continuity

`keep` preserves the current body controller. During combat it continues attacks
and controller-owned movement; when no body task or combat is running it is idle.
The display distinguishes these states. Neither a probability nor a
`keptCurrent` receipt proves damage, movement or completion.

Fast engagement issues a fresh ranged lease when changing targets. Cancelling
the old shot without replacing that lease prevented `tryRanged` from sending
new shots, despite `fighting=true`. Late results from the previous target remain
invalid and cannot mark the current weapon unavailable.

The candidate pool uses the existing 32-block ranged acquisition boundary
when the backend reports a usable ranged weapon. Otherwise the configured melee
pursuit boundary is retained. The 40-block ranged tracking boundary remains a
retention limit, not an acquisition limit. Visibility, loaded identity, neutral
entity rules, floor separation, health, ownership and cancellation are unchanged.
Passive proximity defense does not acquire farther targets automatically.

An explicitly selected, still-visible identity in the controller's scan counts
as an ongoing target until it disappears or leaves the allowed tracking range.
Unselected distant creatures do not hold the body indefinitely.

Controller replay covers a visible target outside melee range, actual calls to
the ranged executor, cancellation/resumption, empty ammunition, unchanged passive
acquisition and late callbacks from an old target. Live gameplay must separately
confirm projectile/hit receipts after deployment.
