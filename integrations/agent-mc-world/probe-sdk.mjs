// Direct SDK consumer. No MCP transport, HTTP listener or model.
// Default is discovery only. --connect logs in and submits only read requests,
// but the upstream runtime's survival reflexes still exist: use a test account.
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
// Resolve the loader from the installed package, not a global tsx installation.
const packageRequire = createRequire(require.resolve('agent-mc-world/package.json'));
const { register } = packageRequire('tsx/esm/api');
register();
const { MinecraftAgentClient, loadMinecraftClientConfig, nullLogger } = await import('agent-mc-world/client');
const args = process.argv.slice(2);
if (args.length < 1 || args.length > 2 || (args[1] && args[1] !== '--connect')) {
  throw new Error('Usage: node probe-sdk.mjs <private-config.json> [--connect]');
}
const options = loadMinecraftClientConfig(path.resolve(args[0]));
if (options.cfg.viewerPort || options.cfg.local.serverDir || options.cfg.local.startWithWorld ||
    options.cfg.local.cheats || options.cfg.client.enabled || options.cfg.player.enabled ||
    options.cfg.combat.enabled || options.cfg.idle.enabled) {
  throw new Error('Probe requires external server, disabled viewers/Java launchers/combat/idle and no cheats. Use server.example.json.');
}
const client = new MinecraftAgentClient({ ...options, log: nullLogger() });
const report = { transport: 'direct-sdk', mcpStarted: false, modelRequests: 0,
  connected: false, toolCount: client.tools().length, fullModSupportVerified: false,
  explicitRequestsReadOnly: true, builtinSurvivalReflexesDisabled: false };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  if (args[1] === '--connect') {
    await client.connect();
    const deadline = Date.now() + 30000;
    const online = () => client.status().lamps.some(lamp => lamp.label === '服务器' && lamp.state === 'online');
    while (!online() && Date.now() < deadline) await pause(200);
    assert.ok(online(), 'No confirmed game connection within 30 seconds');
    const started = await client.call('mc_script', { name: 'sdk_read_only_probe', durationMs: 10000,
      code: 'return {entity:await bot.read("entity"),health:await bot.read("health"),food:await bot.read("food"),game:await bot.read("game")};' });
    assert.notEqual(started.failed, true, started.text);
    const id = Number(started.text.match(/\{"id":(\d+)/)?.[1]);
    assert.ok(Number.isInteger(id) && id > 0, 'No script receipt ID');
    const until = Date.now() + 15000;
    let terminal;
    while (Date.now() < until) {
      await pause(200);
      const receipt = await client.call('mc_script', { runId: id });
      assert.notEqual(receipt.failed, true, receipt.text);
      terminal = JSON.parse(receipt.text);
      if (terminal.status !== 'running') break;
    }
    assert.equal(terminal?.status, 'completed', 'Read-only script did not complete');
    assert.ok(terminal.result?.entity?.position, 'Missing actual player position');
    report.connected = true;
    report.snapshot = terminal.result;
    report.sampledAt = terminal.endedAt;
    await client.journal.renderDeferred();
    const events = client.journal.read(0, 256, client.journal.run);
    report.events = { run: events.run, nextCursor: events.nextCursor, count: events.events.length, gap: events.gap };
  }
} finally {
  await client.disconnect();
  report.disconnected = client.status().phase === 'disconnected';
}
console.log(JSON.stringify(report, null, 2));
