# Food risk and explicit consumption

`foodRiskReference(item)` is a pure public helper at `agent-mc-world` and `agent-mc-world/extension`. It returns the existing verified Java 1.21.1 baseline caution, effect duration/amplifier/probability, source and knowledge ID. `serverComponentsVerified` is false: a reference is neither a current status effect nor proof that a server/custom component retains vanilla behavior. Unknown custom IDs and ordinary safe food return null. Returned effect arrays do not mutate the reference catalogue.

For the Mineflayer backend, the same specific cautions appear in current carried-food facts, full backpack reads, exact-ID stock queries, low-health recovery facts and `eat` preflight receipts. This closes a gap where a risky explicit meal received no preflight warning when there was no safe alternative. Hunger, available food, absence of safe food, expected side effects and actual post-consumption effects remain separate facts. Other backends can consume the public helper; their native operation contracts do not automatically acquire Mineflayer preflight behavior.

`effects` contains only status effects present in the verified baseline table. An empty list is not a safety certificate: teleportation and component-dependent effects are described by `caution`, and custom stacks remain unverified.

An explicit `eat pufferfish` remains an allowed request. Preflight is a soft diagnostic, does not replace the selected item and does not require a new permission flag. Automatic routine food selection already excludes harmful/special food; the familiar-action recognizer now shares that same risk set rather than an incomplete duplicate. Emergency rotten-flesh/raw-chicken fallback and safe raw fish remain available through their original contracts.

Actual consumption still requires the original inventory/hand and nutrition/native consumption evidence. The terminal retains real side effects even when hunger increased. A task marked completed only describes the requested action; it does not mean that the meal was healthy, that a recovery objective succeeded or that another meal should be replayed.

This is a general core information fix. It adds no character prompt, personal memory edit, automatic antidote, server command, hidden model call or world-specific food rule. Packed SDK/MCP consumers can use the same public helper and live tool facts.
