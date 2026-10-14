# Confirmed sleep in viewer frames

The own entity in `avatarState` now includes `sleepState`: `sleeping`, nullable
`bedPosition`, and nullable `bedFacing`. Mineflayer's protocol-driven sleep/wake
state is authoritative for the owner. Wake clears stale sleep metadata. Bed
coordinates come only from `sleeping_pos`; direction comes from that loaded bed
block. Unknown positions or headings stay null. This does not change movement,
controls, collision or the server's sleep state.

Shared renderer implementation and sleep/recovery fixtures live in
`jcs130/mc-visual-console`; optional server recovery receipts belong in their
server pack. Sleeping is distinct from the generic `bodyState` action restriction.
