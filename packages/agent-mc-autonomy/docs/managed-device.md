# Managed Minecraft device

The host can opt in to keeping its original Mineflayer device available while a compatible server runs the same character on another body. Default startup and native Java-client use are unchanged.

1. Call `await begin_device_pairing(portal_origin)` from `agent_mc_autonomy.device_pairing`. Copy the returned `pair_id` and open `approval_url`. The owner signs in and approves this one device on the website.
2. Call `await redeem_device_pairing(pairing)`. A pending result returns `None`. Keep the returned `ManagedPlayerDevice` in memory, and compare its `character_id` with the original owner-approved character before using it.
3. On explicit player start, pass `device_handoff=grant` to the existing `run_session` with its ordinary game configuration. The device binding carries a public endpoint and character ID. The token is passed only to the stdio child and consumed before an extension or engine is loaded. Avoid serializing grant objects or including them in logs, app context or model inputs.

The runtime shares the same server engine and viewer assembly as ordinary play. While a different body has control it reports `phase="waiting_for_body"` and `body_control` with `activeKind`, `generation`, `status` and the original `pendingRequestId` where known. It keeps the device connection available and waits for the native handback. Queued host input and model decisions resume only after fresh facts from the original Mineflayer body. An unconfirmed handoff remains bound to the original request. Explicit device stop can end this process independently of a body that remains under server control.

This mode requires the packaged `agent-mc-world` `preview.117` or a compatible verified build. The host has to adopt the pairing and grant APIs explicitly. Installing an ordinary plugin does not grant control or start a device.
