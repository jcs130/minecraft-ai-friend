# Observed projectiles and shield use

The embedded viewer consumes the same observed entities and outgoing use packets as the Minecraft client. It does not aim, block, extend a projectile's lifetime, or infer a successful hit.

- Nearby short-lived projectile spawn, movement and removal observations bypass the ordinary entity batch. Distance, entity-count and transport backpressure limits still apply. The Java 1.21.1 and 1.20.6 socket fixtures cover potion, arrow, fireball, thrown-item and other projectile events arriving within one batch interval.
- `avatarState.shieldRaised` requires an observed shield-use packet, current item use, a living player and a shield in that hand. `shieldHand` is `mainhand`, `offhand`, or `null`; `usingOffhand` follows the actual selected hand. Release, slot changes and use of another item clear the indication. Merely carrying a shield does not raise it.
- The frozen shared viewer provides original projectile models/textures and uses active-hand metadata for remote players. Paper YSM models use authored shield-use animation where available; supported articulated models otherwise receive a viewer pose. Unsupported rigs/material metadata remain explicitly unavailable.
- The displayed pose proves only presentation of observed use state. Damage blocking, cooldown, attacker direction and server-specific behavior require separate game evidence. Original particle effects and every version's potion-color mapping are not claimed to be complete.

Rendering source and asset provenance: `jcs130/mc-visual-console`, locked by `release-sources.json`. Private character resources and deployment settings are not packaged here. Consumers with an explicit external viewer directory must update its static assets separately from the core package.
