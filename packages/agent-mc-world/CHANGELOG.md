# Changelog

## 0.5.7-rc.131

Keep the existing server/account/agent binding for optional memory-service workflows across native map changes. Local spatial notes retain their separate native-map namespaces and captures include native world identity. Preserve ownership rejection and pending-correction checks; do not rebind or rewrite existing memory ledgers.

## 0.5.7-rc.130

Keep durable goal intentions scoped to server/account/agent across native map changes; map-specific runtime proof is re-read. Preserve the original checkpoint namespace instead of silently replacing it when upgrading world identity isolation.

Add optional nearby voice through the existing authenticated connection, canonical standalone/SDK helper, native-world/authentication gating, same-ID recovery and separate game/livestream outputs. Reuse one audio artifact and preserve current voice/provider in the presentation extension. Retain real UUID/utterance provenance in a separate nearby-voice inbox channel. Include the latest upstream native-world isolation and the previously prepared reliability fixes.
## 0.5.7-rc.139

- Integrate main and the deployed rc.137 client capability line without changing server code.
- Preserve proximity voice, chat audience evidence and memory-service identity alongside main's plan, command and measured-motion review.
- Publish configured read-only query IDs and structured argument discovery from the same protocol definitions used to dispatch commands.
