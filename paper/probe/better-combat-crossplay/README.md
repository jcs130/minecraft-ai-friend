# Better Combat crossplay regression

The server runs Minecraft 1.21.1 with Youer and Better Combat 2.4.0. The probe records Bukkit's damage settlement and the Better Combat animation payload on each receiving connection. The NeoForge client probe can press the ordinary attack key and saves a game frame when the Better Combat attack layer becomes active.

`fixture.py` copies an existing disposable Youer installation with Geyser and ViaVersion into a fresh directory. The template must contain the synthetic `.combat-crossplay-qa` marker. The copied server, Geyser and RCON listeners are for local probes. Only the synthetic Geyser instance accepts an unsigned Bedrock test session. Stop the fixture by creating `stop` in its root.

```text
python fixture.py --base <synthetic-youer-template> --bridge <hosted-bridge.jar> --jdk <jdk-21> --output <fixture>
python client_fixture.py --server <fixture> --launcher-manifest <neoforge-launch.json> --libraries <client-libraries> --jdk <jdk-21> --output <fixture>/observer --name BCQAViewer
python client_fixture.py --server <fixture> --launcher-manifest <neoforge-launch.json> --libraries <client-libraries> --jdk <jdk-21> --output <fixture>/native --name BCQANative
node matrix.cjs <fixture> <mineflayer-project/package.json> <bedrock-protocol-project/package.json>
```

The matrix uses Mineflayer 4.39.0 and a Bedrock 26.60 protocol client through the actual Geyser plugin. Run the old bridge with `baseline` after the package paths to compare damage and animation counts for the ordinary melee cases. Only the viewer is needed in baseline mode. Both modes write `matrix.json` into the fixture. The second modded client is moved outside tracking distance before the ordinary strike checks.

For an unmodified Java input check, join the fixture as `BCQAStock`, equip an iron sword and left-click a tagged test zombie in view of `BCQAViewer`. The ordinary attack should cause one `BCQA_DAMAGE` entry and one `BCQA_ANIMATION` entry for the modded viewer. The client render probe records whether a real attack animation played. Use a fresh account in the fixture and keep any stock viewer within tracking range during the other cases to check that it receives no Better Combat payload.

Native Better Combat starts the animation during wind-up. A compatibility animation starts after the normal main-target hit is accepted. Plain Java and Bedrock keep their regular client rendering path. The Bedrock protocol probe verifies packet translation and vanilla animation events; the visual frames come from the actual Java Better Combat renderer.
