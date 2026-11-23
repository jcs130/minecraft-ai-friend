import '../core/dependency-patches.ts';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { minecraftTextComponent } from '../core/nbt-text.mjs';

// Shape observed live on 橘乡 (2026-11-23): a guild hover prefix and a /msg click name are
// wrapped in many empty `extra` layers before " > " and the player's message body.
function wrap(node: Record<string, unknown>, levels: number): Record<string, unknown> {
  let out = node;
  for (let i = 0; i < levels; i++) out = { text: '', extra: [out] };
  return out;
}
function guildChat(body: string) {
  const prefix = wrap({ text: '', hover_event: { action: 'show_text', value: wrap({ text: '公会: 无限城\n' }, 4) },
    extra: [wrap({ text: '[无限城]', color: 'white' }, 3)] }, 4);
  const name = wrap({ text: '', click_event: { action: 'suggest_command', command: '/msg Player_B ' },
    extra: [wrap({ text: 'Player_B', color: 'white' }, 3)] }, 3);
  const sep = wrap({ text: ' > ', color: 'gray' }, 3);
  const msg = wrap({ text: body, color: 'white' }, 4);
  return { text: '', extra: [prefix, name, sep, msg] };
}
function nbtOf(value: unknown): unknown {
  if (typeof value === 'string') return { type: 'string', value };
  if (Array.isArray(value)) return { type: 'list', value: { type: 'compound', value: value.map((v) => (nbtOf(v) as { value: unknown }).value) } };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = nbtOf(v);
  return { type: 'compound', value: out };
}

describe('deeply nested server chat components', () => {
  it('core renderer keeps the message body of deeply nested chat (plain and NBT forms)', () => {
    const chat = guildChat('大家好，欢迎新人！');
    expect(minecraftTextComponent(chat)).toBe('[无限城]Player_B > 大家好，欢迎新人！');
    expect(minecraftTextComponent(nbtOf(chat))).toBe('[无限城]Player_B > 大家好，欢迎新人！');
  });

  it('renders heterogeneous-list {"": text} entries instead of dropping them', () => {
    const join = { text: '', extra: [{ text: '+', color: 'green' }, { '': ' ' }, { text: 'ag_cormy', color: 'gray' }] };
    expect(minecraftTextComponent(join)).toBe('+ ag_cormy');
  });

  it('prismarine-chat toString (Mineflayer message event) keeps the body after the depth patch', () => {
    const req = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
    const ChatMessage = req('prismarine-chat')('1.21.1');
    const msg = new ChatMessage(guildChat('今晚一起去钓鱼吗'));
    expect(msg.toString()).toBe('[无限城]Player_B > 今晚一起去钓鱼吗');
  });
});
