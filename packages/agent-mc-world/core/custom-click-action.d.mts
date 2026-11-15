export function varintBuffer(n: number): Buffer;
export function stringBuffer(value: string): Buffer;
export function encodeAnonymousNbt(nbtTag: unknown): Buffer;
export function encodeLengthPrefixedAnonymousNbt(nbtTag: unknown): { nbtBuf: Buffer; payload: Buffer };
export function encodeOptionalAnonymousNbt(nbtTag: unknown): Buffer;
export function getServerboundPacketId(client: { version: string; state: string }, packetName: string): number;
export function encodeCustomClickActionPacket(client: { version: string; state: string }, id: string, nbtTag: unknown): {
  encoding: 'lengthPrefixed'; packetId: number; state: string; nbtBytes: number; packetBytes: number; buf: Buffer;
};
export function writeCustomClickLengthPrefixed(client: { version: string; state: string; writeRaw(buf: Buffer): void }, id: string, nbtTag: unknown): {
  encoding: 'lengthPrefixed'; packetId: number; state: string; nbtBytes: number; packetBytes: number;
};
