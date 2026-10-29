# Changelog

## 0.5.7-rc.130

Keep durable goal intentions scoped to server/account/agent across native map changes; map-specific runtime proof is re-read. Preserve the original checkpoint namespace instead of silently replacing it when upgrading world identity isolation.

Add optional nearby voice through the existing authenticated connection, canonical standalone/SDK helper, native-world/authentication gating, same-ID recovery and separate game/livestream outputs. Reuse one audio artifact and preserve current voice/provider in the presentation extension. Retain real UUID/utterance provenance in a separate nearby-voice inbox channel. Include the latest upstream native-world isolation and the previously prepared reliability fixes.
