#!/usr/bin/env node
const { startMinecraftClientConsole } = await import('../dist/runtime/src/client/cli.js');
await startMinecraftClientConsole();
