// Verify raw packet captures, rather than inferring privacy from rendered text.
// Usage: node paper/probe/verify-native-chat-capture.mjs <capture.json>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

export function unwrapNbt(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(unwrapNbt);
  if (value.type === 'compound') return Object.fromEntries(
    Object.entries(value.value).map(([k, v]) => [k, unwrapNbt(v)]));
  if (value.type === 'list') return value.value.value.map(unwrapNbt);
  if (typeof value.type === 'string' && Object.hasOwn(value, 'value')) return value.value;
  return value;
}

export function componentUuid(value) {
  const id = unwrapNbt(value)?.hoverEvent?.contents?.id;
  if (typeof id === 'string') return id.toLowerCase();
  if (!Array.isArray(id) || id.length !== 4 || !id.every(n => Number.isInteger(n)
      && n >= -2147483648 && n <= 2147483647)) return null;
  const hex = id.map(n => (n >>> 0).toString(16).padStart(8, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20)].join('-');
}

export function latestChatTypes(packets) {
  // Login limbo and Paper each send a configuration registry. A later table
  // replaces the earlier table; keeping the first table mislabels type IDs 2/3.
  const latest = packets.filter(p => p.id === 'minecraft:chat_type').at(-1);
  assert(latest?.entries?.length, 'missing final chat-type registry');
  return latest.entries.map(entry => ({key: entry.key,
    translation: unwrapNbt(entry.value)?.chat?.translation_key}));
}

export function verifyNativeChatCapture(capture) {
  assert.equal(capture.passed, true, 'capture did not complete successfully');
  const summary = [];
  for (const version of capture.versions) {
    const types = latestChatTypes(version.registry);
    let checked = 0;
    for (const sample of version.samples) {
      assert.equal(sample.packets.length, 2, 'self-message must produce exactly two packets');
      const directions = new Set();
      for (const packet of sample.packets) {
        assert(['profileless_chat', 'player_chat'].includes(packet.packet),
          'private message must retain the native typed chat packet');
        const p = packet.data, index = typeof p.type === 'number' ? p.type : p.type?.chatType;
        const type = types[index];
        assert(type, 'unknown chat-type index');
        const incoming = type.key === 'minecraft:msg_command_incoming';
        const outgoing = type.key === 'minecraft:msg_command_outgoing';
        assert(incoming || outgoing, 'packet uses public/system chat type');
        assert.equal(type.translation, 'commands.message.display.' + (incoming ? 'incoming' : 'outgoing'));
        directions.add(type.key);
        assert.equal(unwrapNbt(p.message ?? {type:'string', value:p.plainMessage}), sample.marker);
        const name = p.name ?? p.networkName;
        assert.equal(unwrapNbt(name).text, 'ag_AuthQA', 'decorated or incorrect sender name');
        assert.equal(p.senderUuid ?? componentUuid(name), version.uuid, 'sender UUID mismatch');
        if (outgoing) assert.equal(componentUuid(p.target ?? p.networkTargetName), version.uuid);
        checked++;
      }
      assert.equal(directions.size, 2, 'incoming and outgoing types must be distinct');
    }
    assert(checked > 0, 'capture has no private-chat packets');
    summary.push({version: version.version, registryTables: version.registry.length,
      aliases: version.samples.map(s => s.alias), checkedPackets: checked});
  }
  assert(summary.length > 0, 'capture has no protocol versions');
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert(process.argv[2], 'supply a raw capture JSON file');
  console.log(JSON.stringify({passed:true,
    summary:verifyNativeChatCapture(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')))}));
}
