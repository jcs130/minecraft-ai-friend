'use strict';
// A real vanilla protocol client: never advertises or implements Numen channels.
const fs = require('node:fs');
const mineflayer = require('mineflayer');
const [mode, directory, portText] = process.argv.slice(2);
if (!['baseline', 'optional'].includes(mode) || !directory || !/^\d+$/.test(portText || '')) throw Error('mode, evidence directory, port required');
const file = `${directory}/${mode}-client.json`;
if (fs.existsSync(file)) throw Error('Keep earlier evidence; choose a new directory');
const result = {mode, protocol: 'vanilla_1.21.1', implementsNumen: false, modelCalls: 0,
  joined: false, chunks: 0, inventoryPackets: 0, numenPayloads: 0, bodySeen: false};
const bot = mineflayer.createBot({host: '127.0.0.1', port: Number(portText), username: 'MawOptOwner', version: '1.21.1', auth: 'offline', physicsEnabled: false});
let ended = false, interval, timer, capabilityStarted = false;
function finish(reason) {
  if (ended) return;
  ended = true; clearInterval(interval); clearTimeout(timer);
  result.reason = reason; result.playerUuid = bot.player?.uuid;
  result.ok = mode === 'baseline' ? !result.joined && !!result.kicked
    : result.joined && result.chunks > 0 && result.inventoryPackets > 0 && result.bodySeen
      && result.vanillaPhaseNumenPayloads === 0 && result.capabilityRosters > 0 && !result.error;
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  bot.quit('Optional Numen QA complete');
  setTimeout(() => process.exit(result.ok ? 0 : 1), 600);
}
bot._client.on('packet', (packet, meta) => {
  if (meta.name === 'map_chunk') result.chunks++;
  if (meta.name === 'window_items' || meta.name === 'set_slot') result.inventoryPackets++;
  if (meta.name === 'custom_payload' && /^(numen|numen_api):/.test(packet.channel || '')) {
    result.numenPayloads++;
    if (capabilityStarted && packet.channel === 'numen_api:companion_list') {
      result.capabilityRosters = (result.capabilityRosters || 0) + 1;
      // The exact upstream codec starts with worldId, followed by a VarInt-sized roster.
      result.nativeRosterBytes = Buffer.isBuffer(packet.data) ? packet.data.length : null;
      setTimeout(() => finish('Vanilla phase and explicit capability delivery finished'), 250);
    }
  }
});
bot.once('spawn', () => {
  result.joined = true;
  if (mode === 'baseline') return finish('Unexpected unpatched login success');
  setTimeout(() => bot.chat('/numen player summon MawOptBody'), 600);
  setTimeout(() => bot.chat('/numen settings'), 1500);
  interval = setInterval(() => {
    const body = bot.players.MawOptBody;
    if (body?.entity) {
      result.bodySeen = true;
      result.bodyUuid = body.uuid;
      result.bodyPosition = body.entity.position;
      const ready = `${directory}/optional-client-ready.json`;
      if (!fs.existsSync(ready)) fs.writeFileSync(ready, JSON.stringify({bodyUuid: body.uuid, bodyPosition: result.bodyPosition}));
    }
    if (!capabilityStarted && fs.existsSync(`${directory}/release-client.json`)) {
      result.vanillaPhaseNumenPayloads = result.numenPayloads;
      capabilityStarted = true;
      result.capabilitySimulationOnly = true; // Not a real Java G panel or MCP UI test.
      bot._client.registerChannel('numen_api:companion_list', ['restBuffer', {}], true);
      setTimeout(() => bot.chat('/numen player summon MawOptBody'), 500);
    }
  }, 300);
});
bot.on('kicked', reason => {result.kicked = reason; if (mode !== 'baseline') result.error = 'kicked'; finish('kicked');});
bot.on('error', error => {result.error = String(error); finish('error');});
bot.on('end', reason => {if (!ended) {result.error = 'premature end'; finish(String(reason));}});
timer = setTimeout(() => finish('timeout'), mode === 'baseline' ? 20000 : 45000);
