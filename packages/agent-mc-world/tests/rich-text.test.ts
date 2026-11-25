import { describe, it, expect, afterEach } from 'vitest';
import { richTextFacts, richTextAnnotation } from '../core/rich-text.mjs';
import { minecraftTextComponent, setMinecraftTextLanguage } from '../core/nbt-text.mjs';

afterEach(() => setMinecraftTextLanguage(null));

describe('rich text facts (local TIG adaptation)', () => {
  it('reads legacy clickEvent/hoverEvent from a sign-in hint', () => {
    const c = { text: '', extra: [{ text: '你今天还没有签到! ', color: 'yellow' },
      { text: '[点击此处打开签到界面]', color: 'green', clickEvent: { action: 'run_command', value: '/signin gui' },
        hoverEvent: { action: 'show_text', contents: { text: '打开签到界面' } } }] };
    const f = richTextFacts(c);
    expect(f.clicks).toEqual([{ action: 'run_command', value: '/signin gui', label: '[点击此处打开签到界面]' }]);
    expect(f.hovers[0].text).toBe('打开签到界面');
    expect(f.colors).toContain('green');
    expect(richTextAnnotation(c)).toContain('→执行 /signin gui');
  });
  it('reads 1.21.5+ snake_case click_event/hover_event and NBT-wrapped components', () => {
    const c = { type: 'compound', value: {
      text: { type: 'string', value: '官网' },
      click_event: { type: 'compound', value: { action: { type: 'string', value: 'open_url' }, url: { type: 'string', value: 'https://example.test' } } },
      hover_event: { type: 'compound', value: { action: { type: 'string', value: 'show_text' }, value: { type: 'string', value: '点我' } } },
    } };
    const f = richTextFacts(c);
    expect(f.clicks[0]).toMatchObject({ action: 'open_url', value: 'https://example.test' });
    expect(f.hovers[0].text).toBe('点我');
  });
  it('reports custom fonts and private-use icon glyphs', () => {
    const c = { text: '\uE001 金币 100', font: 'tig:icons' };
    const f = richTextFacts(c);
    expect(f.fonts).toEqual(['tig:icons']);
    expect(f.icons).toEqual([{ code: 'U+E001', font: 'tig:icons' }]);
    expect(richTextAnnotation(c)).toContain('U+E001@tig:icons');
  });
  it('resolves translate keys with the connection language table', () => {
    const c = { translate: 'multiplayer.player.joined', with: [{ text: 'ag_example' }] };
    expect(minecraftTextComponent(c)).toBe('multiplayer.player.joined ag_example');
    setMinecraftTextLanguage({ 'multiplayer.player.joined': '%s joined the game' });
    expect(minecraftTextComponent(c)).toBe('ag_example joined the game');
    expect(richTextFacts(c).translateKeys).toEqual(['multiplayer.player.joined']);
  });
  it('is empty for plain text', () => {
    expect(richTextAnnotation('hello')).toBe('');
    expect(richTextAnnotation({ text: 'hi', color: 'gold' })).toBe('');
  });
});
