#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { startMcpStdio } from 'agent-mc-world/mcp/stdio'
import { createMyAgentWorldClient, HOST_INSTRUCTIONS } from './index.mjs'

await startMcpStdio((file, log) => {
  let config
  try { config = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch { throw Error('maw_host_private_config_unreadable') }
  return { runtime: createMyAgentWorldClient(config, { log }), metricsPort: 0, consolePort: 0, instructions: HOST_INSTRUCTIONS }
}, 'my-agent-world-mcp')
