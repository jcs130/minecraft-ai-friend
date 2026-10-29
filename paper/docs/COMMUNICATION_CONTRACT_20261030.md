# Chat scope and skill invocation observations

This candidate keeps EssentialsXChat as the chat router. AgentFriend reads the
enabled Essentials runtime `Settings` (`getChatRadius`, `getChatShout`,
`isShoutDefault`, `isPersistShout`) at observation time. It publishes
`communication.schema=agent-mc/chat-policy/v1` in the existing welcome/status
envelopes and in `MC_COMMUNICATION` after a native Vortex status query.
Persistent per-player shout mode makes the default unknown. An unavailable
provider returns unknown and invalidates a client's old policy. Permission-node
checks are observations, not a promise that mute, ignore or another plugin will
permit delivery. World key/UUID remain distinct from localized display labels.

The local no-listener message no longer hardcodes 48 blocks or says dimension;
the dynamic radius is in the policy. Mentions do not widen scope. These changes
do not reroute messages, create listeners, replay a failed send or enable TTS.

Native RPG skill information adds an `invocation` object. A common capability
whose actual command is not `/mycli cast <id>` returns
`reason=command_route_mismatch`, `changed=false`, its advertised command, and
the same typed skill detail when sent to cast. `queryOnly` continues to describe
the information query, not whether the capability itself is callable by cast.
The server does not append rejected arguments to another command or perform it.

Local acceptance: `AgentCommunicationContractTest` exercises data-only policy
and invocation rules with JDK 21. Client tests replay the real native `travel`
detail and modern Mineflayer player packet codec. Full Paper/Essentials build,
isolated routing/permission/mute/ignore checks, and production loading are
separate and have not been performed by this local candidate. Deployment must
be coordinated with the server owner using the current server artifact baseline.
