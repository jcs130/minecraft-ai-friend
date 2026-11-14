import { describe, expect, it } from 'vitest';
import { authMePasswordNbt } from '../core/nbt-text.mjs';
import {
  encodeAnonymousNbt, encodeLengthPrefixedAnonymousNbt, encodeOptionalAnonymousNbt, varintBuffer,
} from '../core/custom-click-action.mjs';

describe('custom_click_action encoding', () => {
  it('writes a VarInt length prefix + anonymous NBT, not a presence bit', () => {
    const tag = authMePasswordNbt('fixture-pass');
    const nbtBuf = encodeAnonymousNbt(tag);
    const { payload } = encodeLengthPrefixedAnonymousNbt(tag);
    const prefix = varintBuffer(nbtBuf.length);
    expect(payload.equals(Buffer.concat([prefix, nbtBuf]))).toBe(true);
    const optionBit = encodeOptionalAnonymousNbt(tag);
    expect(payload.equals(optionBit)).toBe(false);
    expect(optionBit[0]).toBe(1);
    expect(optionBit.subarray(1).equals(nbtBuf)).toBe(true);
    expect(nbtBuf.includes(Buffer.from('fixture-pass', 'utf8'))).toBe(true);
    expect(payload.includes(Buffer.from('fixture-pass', 'utf8'))).toBe(true);
  });
});
