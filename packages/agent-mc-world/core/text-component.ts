/** Plain text from the chat components used by 1.20.6 titles and action bars. */
export function minecraftTextComponent(value: unknown): string {
  const unwrapNbt = (input: unknown, depth: number): unknown => {
    if (depth > 16 || !input || typeof input !== 'object') return input;
    if (Array.isArray(input)) return input.map((part) => unwrapNbt(part, depth + 1));
    const tag = input as Record<string, unknown>;
    if (typeof tag.type === 'string' && 'value' in tag) return unwrapNbt(tag.value, depth + 1);
    return Object.fromEntries(Object.entries(tag).map(([key, part]) => [key, unwrapNbt(part, depth + 1)]));
  };
  const render = (input: unknown, depth: number): string => {
    if (depth > 8 || input === null || input === undefined) return '';
    if (typeof input === 'number') return String(input);
    if (typeof input === 'string') {
      const text = input.trim();
      if (/^[\[{\"]/.test(text)) {
        try { return render(JSON.parse(text), depth + 1); } catch { /* plain text */ }
      }
      return input;
    }
    if (Array.isArray(input)) return input.map((part) => render(part, depth + 1)).join('');
    if (typeof input !== 'object') return '';
    const component = input as Record<string, unknown>;
    if (typeof component.toString === 'function' && component.toString !== Object.prototype.toString) {
      const text = component.toString();
      if (text && text !== '[object Object]') return text;
    }
    if (component.value !== undefined && component.text === undefined && component.extra === undefined) {
      return render(component.value, depth + 1);
    }
    let text = component.text === undefined ? '' : render(component.text, depth + 1);
    if (!text && typeof component.translate === 'string') {
      const args = Array.isArray(component.with)
        ? component.with.map((part) => render(part, depth + 1)) : [];
      let nextArg = 0;
      const template = typeof component.fallback === 'string' ? component.fallback : component.translate;
      text = template.replace(/%(?:(\d+)\$)?s/g, (_match, slot: string | undefined) =>
        args[slot ? Number(slot) - 1 : nextArg++] ?? '');
      if (text === template && args.length) text += ` ${args.join(' ')}`;
    }
    if (!text && typeof component.keybind === 'string') text = component.keybind;
    if (!text && typeof component.selector === 'string') text = component.selector;
    if (!text && component.score && typeof component.score === 'object') {
      const score = component.score as Record<string, unknown>;
      if (typeof score.value === 'string' || typeof score.value === 'number') text = String(score.value);
    }
    return text + (component.extra === undefined ? '' : render(component.extra, depth + 1));
  };
  const input = value && typeof value === 'object' && 'type' in value && 'value' in value
    ? unwrapNbt(value, 0) : value;
  return render(input, 0).trim().slice(0, 500);
}
