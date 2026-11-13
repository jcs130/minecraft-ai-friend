# Play Minecraft Java with your own agent

The free **Autonomous Agent for Minecraft** skill gives your agent instructions for using a Minecraft body. **Agent MC World** supplies the local Minecraft MCP process, headless game client, and optional browser viewer. Your agent host supplies the model. Use a Java server that you own or have permission to join. [Get the skill on Agensi](https://www.agensi.io/skills/autonomous-agent-for-minecraft)

## 1. Install the skill in your agent host

Acquire the skill through Agensi and follow your host's skill installation flow. If you have the ZIP, extract it and copy the complete `autonomous-minecraft-agent/` directory, including `SKILL.md` and `references/`. In Codex CLI, place it at `.agents/skills/autonomous-minecraft-agent/` in the project where you start Codex, or in your personal `~/.agents/skills/` directory. In Claude Code, the corresponding directories are `.claude/skills/` and `~/.claude/skills/`. Start a fresh session and select the skill by name. These are instructions for the agent. Set up Minecraft MCP in the steps below. [Codex skill locations](https://developers.openai.com/codex/skills) · [Claude Code skill locations](https://code.claude.com/docs/en/skills)

## 2. Install the pinned Minecraft runtime

On the machine where your agent host will run Minecraft MCP, use Node.js 22+ and npm. Create a dedicated folder, open a terminal there, and run:

```sh
node --version
npm --version
npm init -y
npm install --ignore-scripts --no-audit --no-fund --save-exact agent-mc-world@0.5.7-rc.153
node -p "require('./node_modules/agent-mc-world/package.json').version"
```

The last command should print `0.5.7-rc.153`. This preview contains the viewer integration and matching Java 1.21.1 assets. Keep the generated `package-lock.json` if you want to reproduce the installation with `npm ci --ignore-scripts`. [Pinned npm package](https://www.npmjs.com/package/agent-mc-world/v/0.5.7-rc.153)

## 3. Start or choose a Minecraft Java server

**Private first run.** Install Java 21 and download the dedicated server JAR from Mojang's Java 1.21.1 release page. Save it as `server.jar` in a separate folder. Run the command below once to generate the server files. Review the linked Minecraft EULA and, if you accept it, set `eula=true` in the generated `eula.txt`.

```sh
java -Xms512M -Xmx1024M -jar server.jar nogui
```

In `server.properties`, edit the existing keys to match this local-only test profile:

```properties
server-ip=127.0.0.1
server-port=25565
online-mode=false
```

Run the same Java command again and keep that terminal open. Wait for the server log to show `Done`. Use the offline profile only for a loopback test server. For other servers, keep their authentication settings and use an authorized account. A closed single-player save has no server for the agent to join. For the first test, use the dedicated server. [Official Java 1.21.1 server download](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-1)

**Existing Java server.** Use its actual address, port, compatible protocol version, and approved role. On an online-mode server use `world.auth: "microsoft"`, a stable `world.username` as the local cache identifier, and top-level `"consolePort": 7796`. After initiating the connection, open `http://127.0.0.1:7796/` on the MCP machine and complete Microsoft device authorization yourself when prompted. Keep the profile and authentication cache private. Whitelists, server-side login plugins, and bot rules still apply. [Online account and launcher guide](https://github.com/jcs130/minecraft-ai-friend/blob/main/packages/agent-mc-world/docs/online-accounts.md)

## 4. Create the private profile and register Minecraft MCP

Save the following as `client.json` next to the runtime project's `package.json`. This profile matches the loopback test server above.

```json
{
  "dataDir": "./agent-data",
  "world": {
    "host": "127.0.0.1",
    "port": 25565,
    "username": "LocalAgent",
    "auth": "offline",
    "version": "1.21.1",
    "viewerPort": 7788,
    "remoteTextures": false
  }
}
```

In Codex CLI, run the following with both paths replaced by your local absolute paths. Use an absolute path to the Node executable as well if your host cannot find `node`.

```sh
codex mcp add minecraft -- node "/absolute/runtime/node_modules/agent-mc-world/bin/minecraft-agent-mcp.mjs" "/absolute/runtime/client.json"
codex mcp list
```

For an agent host that accepts `mcpServers` JSON, merge this entry into its existing configuration:

```json
{
  "mcpServers": {
    "minecraft": {
      "command": "node",
      "args": [
        "/absolute/runtime/node_modules/agent-mc-world/bin/minecraft-agent-mcp.mjs",
        "/absolute/runtime/client.json"
      ]
    }
  }
}
```

On Windows, use absolute paths such as `C:/MinecraftAgent/runtime/client.json` or escape backslashes in JSON. Register the process in the agent host and let that host start it. Use one active Minecraft runtime per role. `codex mcp list` confirms the configuration entry. In a fresh session, use tool discovery and `mc_connection` with `{"action":"status"}` to confirm the process is responding. Use the tool names the host actually advertises. [Minecraft MCP reference](https://github.com/jcs130/minecraft-ai-friend/blob/main/packages/agent-mc-world/docs/mcp.md)

## 5. Connect, watch, and verify one action

1. Ask the agent to use the configured local server. It should call `mc_connection` with `{"action":"connect"}`, wait for a ready game connection, and confirm fresh world facts through `mc_protocol` with `{"protocol":"agent-mc/v1","action":"facts"}`. On a server with extra authentication, wait for the server's login confirmation.
2. Check `mc_connection` with `{"action":"viewer-status"}`. After the viewer reports `ready`, use the link from regular connection status or the configured `viewerPort`. With the example profile, open `http://127.0.0.1:7788/` for first person, `http://127.0.0.1:7788/third/` for third person, or `http://127.0.0.1:7788/3dview/` for free 3D. Open the inventory from the viewer toolbar or press `E`. Keep the MCP session connected while watching.
3. Ask: “Give me the local viewer link. Find nearby logs, gather wood, and craft one wooden pickaxe. Verify the change in inventory.” Start in a survival world with reachable logs and a crafting table. Two logs suffice with a table already available. Gather at least three if the agent also needs to craft the table. Wait for each action's terminal receipt and use `mc_bag` or fresh inventory facts to confirm a gain of one `wooden_pickaxe`.
4. Ask the agent to disconnect with `mc_connection` and `{"action":"disconnect"}` when done. The session viewer closes with the connection.

| What you see | What to check |
| --- | --- |
| Skill is present, but there are no Minecraft tools | Install the npm runtime, check the two absolute paths and the Node executable, then restart the host session. Connecting to Agensi MCP alone only makes the skill available. |
| Tools are listed, but the agent is still connecting | Check the game server log, profile host and port, version, role, and authentication. The initial `phase=started` means the runtime has started. |
| Game is ready, but there is no viewer URL | Check that `world.viewerPort` is nonzero and free. Read `viewer-status` for actual game version and resource status. The pinned package includes 1.21.1 assets. Use `viewer-retry` if the runtime reports a failed or compatible viewer and you want it to try the viewer resources again. |
| The viewer URL is on a remote machine | Open it on the MCP machine or use private port forwarding supported by your host. For SSH to a machine you control, run `ssh -N -L 7788:127.0.0.1:7788 user@host` on your own machine, then open `http://127.0.0.1:7788/`. Keep the viewer and the operator console on loopback. |
| The agent broke logs, but crafting fails | Check whether the drops reached its inventory, use the actual wood species, and find or craft a reachable crafting table. Read the original action receipt before retrying. |

## Use a normal Minecraft Java window

For human co-play, launch your installed copy of Minecraft Java with your usual launcher and join the same server through Multiplayer. Use a separate allowed role from the agent. A separate graphical connection uses its own player slot. The browser viewer continues to show the agent's connection.

If you want the runtime to open an already installed graphical client, configure top-level `consolePort` and the optional `world.player` or `world.client` profile. Set `enabled`, a separate `username` and `auth`, `gameDir`, the installed `versionId`, and the matching `javaPath`. After connecting the runtime, start the player or observer from the local connection console. The launcher uses the version files, libraries, and resources already on disk. Automatic Minecraft, JRE, and mod installation is outside this release. [Graphical client configuration](https://github.com/jcs130/minecraft-ai-friend/blob/main/packages/agent-mc-world/docs/online-accounts.md)

## Join Qiandengji only if you choose that world

For the optional community route, use the [official join guide](https://mc.kangqiang.site/join#skill-setup) and the skill's `references/qiandengji.md` for that server's authorization and private profile. Keep the community profile separate from your general `minecraft` MCP configuration. The community headless launcher may require a separate compatible viewer asset directory. Check the actual launcher, authentication, and viewer results before relying on custom content. To return to your own world, disconnect the community role and use your general profile again.
