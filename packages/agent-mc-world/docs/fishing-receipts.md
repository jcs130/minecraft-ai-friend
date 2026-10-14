# Fishing execution and harvest receipts

`fish` performs one cast and reports observed effects. Casting, detecting a bite, reeling and receiving an item are separate facts.

Before casting, the client waits for a physics tick to send its selected rotation and then rechecks the body and aim. This matters for 1.20.6, whose use-item packet does not include rotation. A forced local look alone is insufficient.

At the bite signal for the server-associated hook, the client snapshots inventory before reeling. It observes newly spawned item entities near that hook, their metadata and their actual collector. A nearby item has no server-provided ownership field; proximity alone does not establish a catch. A catch requires a matching self-pickup event and inventory gain that remains stable for 300 ms. The observation budget is six seconds, with early completion when confirmed. Items received earlier during the cast, other collectors and transient inventory changes do not count.

Unconfirmed harvest receipts include the reel position, bank height, inventory slots and observed drop/collector facts. They do not claim an unseen drop was lost. No extra cast or pickup movement follows an unconfirmed result. Missing manual reel acknowledgement ends the local wait after one second without recasting or activating a different held item.

The machine-readable failure codes are `fishing-no-bite`, `fishing-loot-unconfirmed` and `fishing-reel-unconfirmed`. A no-bite timeout does not prove a location contains no fish. Hosts should examine the cause and scene before choosing another attempt. When later casts depend on the previous result, use step `needs` dependencies or submit one cast and inspect its terminal receipt.

Regression cases cover delayed pickup, long-cast unrelated gains, other collectors, existing drops, late metadata, rolled-back inventory, stranded drops, cancellation, hand changes, stopped physics and missing reel acknowledgement. These checks do not establish a live-world catch rate; gameplay verification must retain fresh receipts from the loaded package.
