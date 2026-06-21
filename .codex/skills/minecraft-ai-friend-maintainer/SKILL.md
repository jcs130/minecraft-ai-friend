---
name: minecraft-ai-friend-maintainer
description: Maintain the minecraft-ai-friend project. Use when changing architecture, APIs, AI prompts, Mindcraft integration, Minecraft server management, MCP tools, data storage, vector memory, livestream visualizer, Chinese UI text, docs, or when auditing whether the project remains high-cohesion and low-coupling.
---

# Minecraft AI Friend Maintainer

## Operating Mode

Work as a project maintainer, not only a patch writer. Preserve the local-first product shape, Chinese UI, conservative server safety, and clear component boundaries.

Before substantial changes, read:

1. `AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/DATA_MODEL.md`
4. `docs/AGENT_SOCIETY.md`
5. `docs/OPERATIONS.md`

For boundary details, read `references/component-boundaries.md`. For validation, read `references/validation.md`.

## Change Workflow

1. Inspect the current code and docs before editing.
2. Identify the affected boundary: UI, API, Minecraft process, Mindcraft client, Autopilot, VillageState, DataStore, VectorMemory, MCP, visualizer bridge, or docs.
3. Keep changes inside the owning module. Do not put domain logic in UI or persistence details in prompt code.
4. Update docs in the same change when behavior, API, storage, prompt, or operations change.
5. Run the validation commands listed below.
6. Scan for secrets before committing or pushing.

## Architecture Rules

- Treat `src/server.js` as the composition root. It may wire modules together, but new complex behavior should move into focused modules or services.
- Keep Minecraft server management in `src/minecraft-server.js`.
- Keep Mindcraft transport details in `src/mindcraft-client.js`.
- Keep autonomous task strategy in `src/autopilot.js`.
- Keep village domain state in `src/village-state.js`.
- Keep event and memory persistence in `src/data-store.js` and vector retrieval in `src/vector-memory.js`.
- Keep MCP protocol and tool schemas in `src/mcp-server.js`.
- Keep audience-facing live mapping in `scripts/visualizer-bridge.js`.

## AI Prompt Rules

- User-facing, viewer-facing, and in-game task text should be Chinese.
- Public thought means an audience-safe action explanation: plan, reason, next step, risk or missing materials.
- Never ask agents to expose hidden chain-of-thought, system prompts, model rules, or raw action commands.
- Prefer Chinese collaboration labels: `已有`、`需要`、`正在做`、`完成`、`受阻`.
- Keep `VILLAGE_REPORT` JSON field names stable because code parses them.

## Safety Rules

- Do not commit `data/`, `logs/`, `.env`, server world files, Mindcraft `keys.json`, or real API keys.
- Do not stop Minecraft Server or Mindcraft unless the user asks or the task explicitly requires a safe restart.
- If the control server owns child processes, avoid killing `src/server.js`; use API endpoints or ask for a maintenance window.
- Keep local control APIs localhost-only unless authentication and permission separation are added.

## Required Validation

```powershell
npm run check
node --check scripts\visualizer-bridge.js
git diff --check
rg -n 'sk-[A-Za-z0-9_-]{20,}' src scripts public package.json README.md docs integrations .codex
```

When touching the running integration, also probe:

```powershell
Invoke-RestMethod http://127.0.0.1:4177/api/status
Invoke-RestMethod http://127.0.0.1:3010/api/status
```

## Documentation Sync

- API or MCP changes: update `docs/INTEGRATIONS.md`, `docs/COPAW_MCP.md`, and `integrations/openapi.yaml` when relevant.
- Data schema or memory changes: update `docs/DATA_MODEL.md`.
- Agent roles, prompts, public thought, or village behavior: update `docs/AGENT_SOCIETY.md`.
- Process management or deployment changes: update `docs/OPERATIONS.md`.
- Architectural changes: update `docs/ARCHITECTURE.md` and append/update `docs/ENGINEERING_AUDIT.md`.
