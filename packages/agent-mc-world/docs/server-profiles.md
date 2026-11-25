# Server profiles

One world section can describe several servers and pick one:

```json
"world": {
  "server": "paper-survival",
  "servers": {
    "paper-survival": { "host": "survival.example.test", "port": 25565, "version": "1.21.11",
                        "username": "ag_example", "auth": "offline",
                        "loginConfigFile": "./private-login-config.json",
                        "safety": { "publicChat": true } },
    "snapshot":       { "host": "snapshot.example.test", "version": "26.2", "username": "ag_example" }
  }
}
```

Full example: `examples/minecraft-servers.json`.

## Selecting

- `server` in the world section (host config key `worlds.<id>.server`), or
- `AGENT_MC_SERVER=<profile>` for one process start (wins over the file).

Switching is a connection change: save the new value, then restart the world
(console: `POST /api/config` then `POST /api/run/restart`). Hot config updates keep the
server chosen at start. Without `servers` nothing changes: the top-level `host`/`port`/... are used.

The selected profile's `host, port, version, username, auth, loginConfigFile, fakeHost,
publicDnsFallback, connectAddresses, dohResolvers, connectTimeoutMs, maxReconnectAttempts,
viewerAssetsDir` replace the section's own values (`applyServerProfile`, `core/server-profiles.ts`).
Server-specific values are never inherited from the section: a profile without `port`, `version`,
`fakeHost` or `connectAddresses` gets 25565, `auto` and no pinned address/SNI host, so one server's
pinned IP can't be dialed for another. Account and transport tuning (`username`, `auth`,
`loginConfigFile`, DoH resolvers, timeouts, viewer assets) do inherit.

## No secrets in profiles

Profiles are validated before use: keys such as `password`, `token`, `secret` are rejected.
Accounts log in through `loginConfigFile`, whose entries reference an environment variable
(`credentialEnv`) or a private file — never an inline password.

`account` rules (`usernamePrefix`, `maxLength` default 16, `avoidNames`) are checked too, so a
profile cannot accidentally use a reserved admin name.

`selectable: false` keeps a profile listed and validated (dry run) but refuses to start with it.

## Safety rules (`safety`)

| key | effect |
| --- | --- |
| `publicChat` | `false` refuses ordinary chat locally (`LOCAL_PUBLIC_CHAT_DISABLED`). Default true. |
| `chat` | `minIntervalMs` (2000), `perMinute` (8), `dedupMs` (60000), `maxChars` (200) anti-spam. |
| `commands` | `mode: all` + `block`, or `mode: allowlist` + `allow`; `minIntervalMs` (1000). `/login` `/register` always pass. |
| `privateMessages` | `false` refuses /msg, /tell, /r ... |
| `protectedCircles` | `{name,x,z,r,world?}` areas for body guards (`insideProtectedCircle`). |
| `structureGuard` | hints for ownership-based structure guards: `radius`, `relaxedWorlds` (native world keys such as `minecraft:resource`). |
| `stopOnWarning`, `warningKeywords` | merged into `miningLimits` (`hardStopOnWarning`, `warningKeywords`). |

Refusals throw `LOCAL_*: ...` before anything is sent, so the agent sees a local refusal
rather than a silent server rejection. The rules are also exposed to world extensions as
`bot.cortiServer`, `bot.cortiServerSafety` and `bot.cortiWorldKey()`.
