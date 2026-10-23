#!/usr/bin/env node
const { startMcpStdio } = await import('../dist/runtime/src/mcp/stdio.js');
await startMcpStdio();
