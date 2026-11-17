#!/usr/bin/env -S npx tsx
/**
 * agent-harness serve — start body + harness + message gateway. Nothing starts unless this is run explicitly.
 *
 *   tsx src/server/cli.ts <private-client-config.json>     real Minecraft body (agent-mc-world config)
 *   tsx src/server/cli.ts --fake-body [--data-dir DIR]     offline fake body for demos
 *   tsx src/server/cli.ts --hash-token < token.txt         print SHA-256 of a token for tokenSha256 (reads stdin)
 */
import { readFileSync } from 'node:fs';
import { hashToken } from '../gateway/auth.ts';
import { startHarnessServer } from './serve.ts';

const USAGE = 'usage: agent-harness-serve <client-config.json> | --fake-body [--data-dir DIR] | --hash-token (stdin)';

async function main(argv: string[]): Promise<void> {
  if (argv[0] === '--hash-token') {
    const token = readFileSync(0, 'utf8').trim();
    if (token.length < 16) throw new Error('token must be at least 16 characters');
    process.stdout.write(`${hashToken(token)}\n`);
    return;
  }
  const fake = argv.includes('--fake-body');
  const dirIdx = argv.indexOf('--data-dir');
  const positional = argv.filter((a, i) => !a.startsWith('--') && i !== dirIdx + 1);
  if ((!fake && positional.length !== 1) || (fake && positional.length)) { process.stderr.write(`${USAGE}\n`); process.exitCode = 2; return; }
  const log = (message: string, data?: Record<string, unknown>) =>
    process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), msg: message, ...(data ? { data } : {}) })}\n`);
  const server = await startHarnessServer({ fakeBody: fake, configPath: fake ? undefined : positional[0],
    dataDir: dirIdx >= 0 ? argv[dirIdx + 1] : undefined, log });
  log('agent-harness serving', { url: server.gateway.url, ws: server.gateway.wsUrl, exclusiveBody: server.integration.exclusive,
    hostTools: server.client.tools().map(t => t.name) });
  const stop = () => { void server.close().then(() => process.exit(0)); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

main(process.argv.slice(2)).catch(error => { process.stderr.write(`agent-harness-serve: ${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); });
