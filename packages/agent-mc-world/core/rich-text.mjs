/**
 * Read the interactive/styling facts of a
 * chat component that plain-text flattening drops — click and hover events
 * (legacy camelCase and 1.21.5+ snake_case), custom fonts and private-use
 * icon glyphs. Facts are descriptive only: nothing here runs a click command,
 * opens a URL or resolves a selector.
 */
import { unwrapNbt, minecraftTextComponent } from './nbt-text.mjs';

const MAX_NODES = 400;
const ICON_RE = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu;
const CLICK_LABEL = {
  run_command: '执行', suggest_command: '填入', open_url: '打开链接', copy_to_clipboard: '复制',
  change_page: '翻页', show_dialog: '打开对话框', custom: '自定义动作', open_file: '打开文件',
};

function rawComponent(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    if (/^[\[{]/.test(t)) { try { return JSON.parse(t); } catch { return value; } }
    return value;
  }
  if (typeof value === 'object') {
    // mineflayer ChatMessage keeps the original component in `json`.
    if (value.json && typeof value.json === 'object') return value.json;
    if ('type' in value && 'value' in value) return unwrapNbt(value);
  }
  return value;
}

function clickOf(node) {
  const c = node.clickEvent ?? node.click_event;
  if (!c || typeof c !== 'object' || typeof c.action !== 'string') return null;
  const value = c.value ?? c.command ?? c.url ?? c.page ?? c.id ?? (c.dialog && typeof c.dialog === 'string' ? c.dialog : undefined);
  return { action: c.action, value: value == null ? '' : String(value).slice(0, 200) };
}

function hoverOf(node) {
  const h = node.hoverEvent ?? node.hover_event;
  if (!h || typeof h !== 'object' || typeof h.action !== 'string') return null;
  if (h.action === 'show_text') {
    const text = minecraftTextComponent(h.contents ?? h.value ?? h.text ?? '', { limit: 300 });
    return text ? { action: 'show_text', text } : null;
  }
  if (h.action === 'show_item') {
    const id = h.contents?.id ?? h.id ?? h.value?.id ?? '';
    const count = h.contents?.count ?? h.count;
    return { action: 'show_item', text: `${String(id).replace(/^minecraft:/, '')}${count ? ' x' + count : ''}` };
  }
  if (h.action === 'show_entity') {
    const name = minecraftTextComponent(h.contents?.name ?? h.name ?? '', { limit: 80 });
    const type = h.contents?.type ?? h.id ?? '';
    return { action: 'show_entity', text: `${String(type).replace(/^minecraft:/, '')}${name ? ' ' + name : ''}`.trim() };
  }
  return { action: h.action, text: '' };
}

/** Facts about one component tree. */
export function richTextFacts(value) {
  const root = rawComponent(value);
  const facts = { clicks: [], hovers: [], fonts: [], icons: [], translateKeys: [], colors: [] };
  let nodes = 0;
  const seen = { click: new Set(), hover: new Set(), font: new Set(), icon: new Set(), tr: new Set(), color: new Set() };
  const walk = (node, font, depth) => {
    if (++nodes > MAX_NODES || depth > 60 || node == null) return;
    if (typeof node === 'string') {
      for (const ch of node.match(ICON_RE) ?? []) {
        const code = 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
        const key = code + '@' + font;
        if (!seen.icon.has(key) && facts.icons.length < 16) { seen.icon.add(key); facts.icons.push({ code, font }); }
      }
      return;
    }
    if (Array.isArray(node)) { for (const part of node) walk(part, font, depth + 1); return; }
    if (typeof node !== 'object') return;
    const f = typeof node.font === 'string' ? (node.font.includes(':') ? node.font : 'minecraft:' + node.font) : font;
    if (f !== 'minecraft:default' && !seen.font.has(f)) { seen.font.add(f); facts.fonts.push(f); }
    if (typeof node.color === 'string' && !seen.color.has(node.color) && facts.colors.length < 8) { seen.color.add(node.color); facts.colors.push(node.color); }
    if (typeof node.translate === 'string' && !seen.tr.has(node.translate) && facts.translateKeys.length < 8) { seen.tr.add(node.translate); facts.translateKeys.push(node.translate); }
    const click = clickOf(node);
    if (click) {
      const key = click.action + '\u0000' + click.value;
      if (!seen.click.has(key) && facts.clicks.length < 8) {
        seen.click.add(key);
        facts.clicks.push({ ...click, label: minecraftTextComponent(node, { limit: 60 }) });
      }
    }
    const hover = hoverOf(node);
    if (hover && hover.text && !seen.hover.has(hover.text) && facts.hovers.length < 6) { seen.hover.add(hover.text); facts.hovers.push(hover); }
    if (node.text !== undefined) walk(node.text, f, depth + 1);
    if (node[''] !== undefined) walk(node[''], f, depth + 1);
    if (Array.isArray(node.with)) walk(node.with, f, depth + 1);
    if (node.extra !== undefined) walk(node.extra, f, depth + 1);
  };
  walk(root, 'minecraft:default', 0);
  return facts;
}

/** Short Chinese annotation appended to the plain line seen by the agent. Empty when nothing extra. */
export function richTextAnnotation(value, { maxHover = 120 } = {}) {
  let facts;
  try { facts = richTextFacts(value); } catch { return ''; }
  const parts = [];
  for (const c of facts.clicks) {
    const label = c.label ? `「${c.label.replace(/\s+/g, ' ').slice(0, 30)}」` : '';
    parts.push(`点击${label}→${CLICK_LABEL[c.action] ?? c.action}${c.value ? ' ' + c.value : ''}`);
  }
  for (const h of facts.hovers) parts.push(`悬浮${h.action === 'show_text' ? '' : '(' + h.action + ')'}: ${h.text.replace(/\s+/g, ' ').slice(0, maxHover)}`);
  if (facts.icons.length) parts.push(`图标字符 ${facts.icons.map(i => i.code + (i.font === 'minecraft:default' ? '' : '@' + i.font)).join(' ')}`);
  else if (facts.fonts.length) parts.push(`自定义字体 ${facts.fonts.join(' ')}`);
  return parts.length ? ' ⟨' + parts.join('；') + '⟩' : '';
}
