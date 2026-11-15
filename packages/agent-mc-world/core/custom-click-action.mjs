/**
 * 1.21.6+ / 26.1 vanilla `custom_click_action` encoding.
 * minecraft-data still types the payload as optional anonymousNbt (presence bit).
 * The server expects a VarInt length prefix + anonymous NBT, so the library writer is wrong.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mfRequire = createRequire(require.resolve('mineflayer/package.json'));
const nbt = mfRequire('prismarine-nbt');
const protodef = mfRequire('protodef');

const writeVarInt = protodef.types.varint[1];
const sizeOfVarInt = protodef.types.varint[2];

export function varintBuffer(n) {
  const buffer = Buffer.alloc(sizeOfVarInt(n));
  writeVarInt(n, buffer, 0);
  return buffer;
}

export function stringBuffer(value) {
  const raw = Buffer.from(String(value), 'utf8');
  return Buffer.concat([varintBuffer(raw.length), raw]);
}

export function encodeAnonymousNbt(nbtTag) {
  return nbt.proto.createPacketBuffer('anonymousNbt', nbtTag);
}

/** Vanilla 1.21.6+ payload: VarInt length + anonymous NBT (not a presence bit). */
export function encodeLengthPrefixedAnonymousNbt(nbtTag) {
  const nbtBuf = encodeAnonymousNbt(nbtTag);
  return { nbtBuf, payload: Buffer.concat([varintBuffer(nbtBuf.length), nbtBuf]) };
}

export function encodeOptionalAnonymousNbt(nbtTag) {
  return Buffer.concat([Buffer.from([1]), encodeAnonymousNbt(nbtTag)]);
}

export function getServerboundPacketId(client, packetName) {
  const minecraftData = require('minecraft-data');
  const mcData = minecraftData(client.version);
  const packet = mcData.protocol[client.state].toServer.types.packet;
  const mappings = packet[1][0].type[1].mappings;
  for (const [hex, name] of Object.entries(mappings)) {
    if (name === packetName) return Number.parseInt(hex, 16);
  }
  throw new Error(`unknown serverbound packet ${packetName} in ${client.state}`);
}

export function encodeCustomClickActionPacket(client, id, nbtTag) {
  const { nbtBuf, payload } = encodeLengthPrefixedAnonymousNbt(nbtTag);
  const packetId = getServerboundPacketId(client, 'custom_click_action');
  const buf = Buffer.concat([varintBuffer(packetId), stringBuffer(id), payload]);
  return { encoding: 'lengthPrefixed', packetId, state: client.state, nbtBytes: nbtBuf.length, packetBytes: buf.length, buf };
}

/** Write one configuration/play `custom_click_action` using the vanilla length-prefixed payload. */
export function writeCustomClickLengthPrefixed(client, id, nbtTag) {
  const encoded = encodeCustomClickActionPacket(client, id, nbtTag);
  client.writeRaw(encoded.buf);
  return { encoding: encoded.encoding, packetId: encoded.packetId, state: encoded.state, nbtBytes: encoded.nbtBytes, packetBytes: encoded.packetBytes };
}
