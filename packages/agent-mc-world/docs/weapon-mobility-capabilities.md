# Weapon choice, crafting and vehicle capabilities

Audited 2026-11-07 against Java 1.21.1 and the pinned Mineflayer 4.37.1.

The previous melee classifier rejected tridents and maces, although a cooldown branch mentioned tridents. Inventory observations were therefore insufficient: armed combat and selection still ignored those items. The shared classifier now includes both, filters exhausted durability, and powers native/reactive combat, explicit attacks, readiness and discovery.

- `attack.weapon` chooses a precise melee item ID for one task. A missing chosen weapon is not replaced by food or another item. Equip confirmation remains required.
- `combat_tactic.meleeWeapons` is a persisted, realm-scoped fallback preference. Omitted preserves it; `[]` clears it. It does not start combat. The fallback scores are preferences, not enchantment-aware damage estimates.
- `loadout.choices` exposes at most eight supported item modes; `choicesOmitted` points the caller to the inventory for the rest. Bow ammunition, crossbow loading and throw outcomes remain separate prerequisites.
- `script api:"weapons"`, `"mobility"`, `"fabrication"` are on-demand guides, not resident prompt additions. The installed `minecraft-agent` skill links equipment knowledge. Existing method versions, verification and explicitly adopted routines remain the learning mechanism.

The existing enchant operation supports reading offers without a paid click. It now accepts `pick` and reconciles one native click with actual enchantment components. Absent effects time out as unknown; cancellation and replacement windows cannot cause a second click or foreign-window cleanup. This is protocol-fixture validation, not evidence of live enchanting proficiency.

## Mobility boundaries

`ride` and `ride_route` already cover mounting and boat travel. Horse/donkey/mule observation, feeding and mounting exist, but horse driving is not implemented by this backend. Native `moveVehicle` input alone is not horse physics or arrival. No unsupported vehicle was added to the driving whitelist.

## Upstream options reviewed

| Project | Relevant parts | Integration boundary |
| --- | --- | --- |
| [PrismarineJS/mineflayer](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md) | Native equipment, enchanting, mount and steering APIs | Keep the core's body owner, cancellation and actual effect checks. An exposed input is not a complete driver. |
| [minecraftHawkEye](https://github.com/sefirosweb/minecraftHawkEye) | Ballistic solution and one-shot helpers | Candidate mathematics to evaluate in recorded scenes; do not install a competing autonomous combat/radar loop. |
| [mineflayer-custom-pvp](https://github.com/nxg-org/mineflayer-custom-pvp) | Sword/bow controllers | Its documented version range does not by itself establish Java 1.21.1 acceptance. It owns movement and combat, so it is not a drop-in second controller. |
| [SpectraPhysics](https://github.com/trqxyz/SpectraPhysics) | Alternative physics with vehicle support | Requires isolated protocol/collision/performance and licence review; its README does not establish a production-ready horse controller here. Not installed. |

[Mineflayer issue 2766](https://github.com/PrismarineJS/mineflayer/issues/2766) is historical evidence of horse steering limitations, not proof of the current implementation. The unsupported status above comes from this core's current driver and the installed backend. No dependency was added based solely on a repository description.
