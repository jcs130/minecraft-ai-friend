import '../core/dependency-patches.ts';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const req = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const nbt = req('prismarine-nbt');

// Java DataOutput.writeUTF / NBT: Modified UTF-8, supplementary chars as two 3-byte surrogates.
function mutf8(s: string): Buffer {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 1 && c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
    else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
  }
  return Buffer.from(out);
}
function compoundWithText(text: string): Buffer {
  const name = Buffer.from('text');
  const body = mutf8(text);
  const len = Buffer.alloc(2); len.writeUInt16BE(body.length);
  const nameLen = Buffer.alloc(2); nameLen.writeUInt16BE(name.length);
  // Network (nameless root) compound: 0x0A, then TAG_String "text", then TAG_End.
  return Buffer.concat([Buffer.from([0x0A]), Buffer.from([0x08]), nameLen, name, len, body, Buffer.from([0x00])]);
}

describe('NBT Modified UTF-8 strings (custom-font glyphs)', () => {
  it('decodes supplementary-plane glyphs instead of U+FFFD runs', () => {
    const glyph = String.fromCodePoint(0xF0001) + String.fromCodePoint(0x1F34A) + ' Player_B 欢迎';
    const { value } = nbt.protos.big.parsePacketBuffer('anonymousNbt', compoundWithText(glyph)).data;
    expect(value.text.value).toBe(glyph);
    expect(value.text.value).not.toContain('\uFFFD');
  });

  it('keeps ordinary UTF-8 (BMP Chinese) unchanged', () => {
    const { value } = nbt.protos.big.parsePacketBuffer('anonymousNbt', compoundWithText('公会: 无限城')).data;
    expect(value.text.value).toBe('公会: 无限城');
  });
});
