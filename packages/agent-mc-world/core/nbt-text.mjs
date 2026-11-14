/** Unwrap prismarine-nbt `{type,value}` trees and render 26.1 chat/window text. */

const NBT_TYPES = new Set([
  'compound', 'string', 'list', 'byte', 'int', 'short', 'long',
  'float', 'double', 'byteArray', 'intArray', 'longArray', 'end', 'bool',
]);

/** Flatten a prismarine-nbt tag or any nested `{type,value}` tree into plain data. */
export function unwrapNbt(node, depth = 0) {
  if (depth > 16 || node == null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map((part) => unwrapNbt(part, depth + 1));
  const type = node.type;
  if (typeof type === 'string' && NBT_TYPES.has(type) && Object.prototype.hasOwnProperty.call(node, 'value')) {
    if (type === 'compound') {
      const out = {};
      const val = node.value && typeof node.value === 'object' ? node.value : {};
      for (const [key, value] of Object.entries(val)) out[key] = unwrapNbt(value, depth + 1);
      return out;
    }
    if (type === 'list') {
      const inner = node.value;
      if (inner && Array.isArray(inner.value)) return inner.value.map((part) => unwrapNbt(part, depth + 1));
      if (Array.isArray(inner)) return inner.map((part) => unwrapNbt(part, depth + 1));
      return [];
    }
    return node.value;
  }
  const out = {};
  for (const [key, value] of Object.entries(node)) out[key] = unwrapNbt(value, depth + 1);
  return out;
}

/** Recursively collect string `id` fields, after unwrapping NBT if needed. */
export function collectActionIds(node, out = []) {
  const value = unwrapNbt(node);
  const walk = (current) => {
    if (!current || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      for (const part of current) walk(part);
      return;
    }
    if (typeof current.id === 'string') out.push(current.id);
    for (const part of Object.values(current)) walk(part);
  };
  walk(value);
  return out;
}

function renderText(input, depth = 0) {
  if (depth > 8 || input === null || input === undefined) return '';
  if (typeof input === 'number' || typeof input === 'boolean') return String(input);
  if (typeof input === 'string') {
    const text = input.trim();
    if (/^[\[{"]/.test(text)) {
      try { return renderText(JSON.parse(text), depth + 1); } catch { /* plain text */ }
    }
    return input === '[object Object]' ? '' : input;
  }
  if (Array.isArray(input)) return input.map((part) => renderText(part, depth + 1)).join('');
  if (typeof input !== 'object') return '';
  const component = input;
  if (typeof component.toString === 'function' && component.toString !== Object.prototype.toString) {
    const text = component.toString();
    if (text && text !== '[object Object]') return text;
  }
  if (component.value !== undefined && component.text === undefined && component.extra === undefined) {
    return renderText(component.value, depth + 1);
  }
  let text = component.text === undefined ? '' : renderText(component.text, depth + 1);
  if (!text && typeof component.translate === 'string') {
    const args = Array.isArray(component.with)
      ? component.with.map((part) => renderText(part, depth + 1)) : [];
    let nextArg = 0;
    const template = typeof component.fallback === 'string' ? component.fallback : component.translate;
    text = template.replace(/%(?:(\d+)\$)?s/g, (_match, slot) =>
      args[slot ? Number(slot) - 1 : nextArg++] ?? '');
    if (text === template && args.length) text += ` ${args.join(' ')}`;
  }
  if (!text && typeof component.keybind === 'string') text = component.keybind;
  if (!text && typeof component.selector === 'string') text = component.selector;
  if (!text && component.score && typeof component.score === 'object' &&
    (typeof component.score.value === 'string' || typeof component.score.value === 'number')) {
    text = String(component.score.value);
  }
  return text + (component.extra === undefined ? '' : renderText(component.extra, depth + 1));
}

/** Plain text from chat components, anonymous NBT titles, or already-unwrapped objects. */
export function minecraftTextComponent(value) {
  const input = value && typeof value === 'object' && 'type' in value && 'value' in value
    ? unwrapNbt(value) : value;
  return renderText(input, 0).trim().slice(0, 500);
}

/** Readable window title; never returns `[object Object]`. */
export function windowTitleText(title, rawTitle) {
  for (const candidate of [rawTitle, title]) {
    if (candidate == null) continue;
    const text = minecraftTextComponent(candidate);
    if (text && text !== '[object Object]') return text;
  }
  return '';
}

export function isAuthMeLoginDialog(dialog) {
  const unwrapped = unwrapNbt(dialog);
  const ids = collectActionIds(unwrapped);
  if (ids.includes('authme:prejoin-login/submit')) return true;
  const title = windowTitleText(unwrapped && unwrapped.title);
  const encoded = JSON.stringify(unwrapped ?? '');
  return title.includes('登录') && encoded.includes('"password"');
}

export function authMePasswordNbt(password) {
  return { type: 'compound', value: { password: { type: 'string', value: String(password) } } };
}
