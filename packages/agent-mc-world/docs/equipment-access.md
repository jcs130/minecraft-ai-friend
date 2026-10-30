# Explicit access to worn equipment

`equip` with an explicit `hand: "main"` or `hand: "off"` can take a selected worn
armor item back into the player's inventory before selecting it. An equip call
without `hand` keeps its existing armor destination. Armor is not added to ordinary
crafting or material stock.

The body checks for storage space, an empty cursor and a closed container before
taking armor off. Native slot and cursor acknowledgments must confirm the move.
Missing confirmation remains unknown; there is no automatic retry, drop, repair
or re-equipping. An anvil request for worn armor explains the explicit equip step
and does not silently remove it.

Hosts retaining their own body can import `takeWornItem` from
`agent-mc-world/equipment`. It is a body-scoped primitive, to be invoked only inside
that body's existing inventory/equipment action. It starts no connection, queue,
World, model or game loop. Pass the body's cancellation check; complete any
already-dispatched slot/cursor transaction before handing ownership back.

The result is `not-worn`, `moved`, `blocked` or `unknown`. Every result carries
`goal_completed: false`: returning an item to inventory is not a completed repair
or adventure. A host must preserve unknown outcomes and confirm any later hand
selection or repair separately. A class or server observer must not call this
through a bodyless query or casting lane.
